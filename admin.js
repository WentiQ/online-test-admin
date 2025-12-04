import { db } from './config.js';
import { collection, addDoc, getDocs, query, where, onSnapshot, doc, updateDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Helper function to check if questions have missing answers
function checkMissingAnswers(questions) {
    for (let q of questions) {
        if (q.type === 'passage' && Array.isArray(q.questions)) {
            // Check sub-questions in passage
            for (let subQ of q.questions) {
                if (!subQ.answer && subQ.answer !== 0 && !subQ.correct && subQ.correct !== 0) {
                    return true;
                }
            }
        } else {
            // Check regular questions
            if (!q.answer && q.answer !== 0 && !q.correct && q.correct !== 0) {
                return true;
            }
        }
    }
    return false;
}

// CREATE EXAM
document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.innerText = "Publishing...";

    try {
        const jsonData = JSON.parse(document.getElementById('json-input').value);
        
        // Support both formats: sections-based and legacy array
        let questions = [];
        let sections = null;
        
        if (Array.isArray(jsonData)) {
            // Legacy format: array of questions
            questions = jsonData;
        } else if (jsonData.sections && Array.isArray(jsonData.sections)) {
            // New format: sections with instructions
            sections = jsonData.sections;
            // Flatten all questions for answer key checking
            jsonData.sections.forEach(section => {
                if (Array.isArray(section.questions)) {
                    questions.push(...section.questions);
                }
            });
        } else {
            throw new Error('Invalid JSON format. Expected array of questions or {sections: [...]}');
        }
        
        // Check if any question is missing answer key
        const hasIncompleteAnswers = checkMissingAnswers(questions);
        const resultsReleasedValue = hasIncompleteAnswers ? false : document.getElementById('resultsReleased').checked;
        
        if (hasIncompleteAnswers) {
            alert('⚠️ Some questions are missing answer keys. Results will be set to PENDING until you add all answers.');
        }
        
        // Parse introduction JSON
        let introductionData = null;
        const introInput = document.getElementById('introduction').value.trim();
        if (introInput) {
            try {
                introductionData = JSON.parse(introInput);
            } catch (e) {
                alert('Introduction JSON is invalid. Please check the format.');
                btn.disabled = false;
                btn.innerText = "Publish Exam";
                return;
            }
        }
        
        // Get result type
        const resultType = document.querySelector('input[name="resultType"]:checked').value;
        
        const examData = {
            title: document.getElementById('title').value,
            introduction: introductionData,
            introTimeLimit: parseInt(document.getElementById('introTimeLimit').value) || 120,
            startTime: document.getElementById('startTime').value,
            endTime: document.getElementById('endTime').value,
            duration: parseInt(document.getElementById('duration').value),
            attemptsAllowed: parseInt(document.getElementById('attempts').value),
            createdAt: new Date().toISOString(),
            expiryDate: document.getElementById('expiryDate').value || null,
            disabled: document.getElementById('disabled').checked,
            resultType: resultType,
            resultsReleased: resultsReleasedValue,
            displayOptions: resultType === 'analysis' ? {
                showMarkingScheme: document.getElementById('showMarkingScheme').checked,
                showRank: document.getElementById('showRank').checked,
                showFinalMarks: document.getElementById('showFinalMarks').checked,
                showCorrectAnswers: document.getElementById('showCorrectAnswers').checked
            } : null
        };
        
        // Store in appropriate format
        if (sections) {
            examData.sections = sections;
            examData.questions = questions; // Also store flattened for backward compatibility
        } else {
            examData.questions = questions;
        }
        
        await addDoc(collection(db, "tests"), examData);
        alert("Exam Published Successfully!");
        e.target.reset();
        loadExamDropdown();
    } catch(err) {
        alert("JSON/Database Error: " + err.message);
    }
    btn.disabled = false; btn.innerText = "Publish Exam";
});

// MONITORING
const examSelect = document.getElementById('exam-select');
let unsubLive = null;
let unsubRank = null;

async function loadExamDropdown() {
    const snap = await getDocs(collection(db, "tests"));
    examSelect.innerHTML = '<option value="">-- Select Exam --</option>';
    snap.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.innerText = d.data().title;
        examSelect.appendChild(opt);
    });
}
loadExamDropdown();

examSelect.addEventListener('change', (e) => {
    const tid = e.target.value;
    if(!tid) return;

    // 1. Live Status
    if(unsubLive) unsubLive();
    const qLive = query(collection(db, "live_status"), where("testId", "==", tid));
    unsubLive = onSnapshot(qLive, (snap) => {
        const tbody = document.getElementById('live-table');
        tbody.innerHTML = '';
        snap.forEach(doc => {
            const d = doc.data();
            const timeDiff = (new Date() - new Date(d.lastActive)) / 1000;
            let status = d.status;
            let badge = 'bg-yellow';
            
            if(d.status === 'Completed') badge = 'bg-green';
            else if(timeDiff > 60 && d.status !== 'Completed') { status = "Offline"; badge = 'bg-red'; }
            
            const phone = d.phone ? `<br><small style="color:var(--gray)">${d.phone}</small>` : '';
            tbody.innerHTML += `<tr><td>${d.name}${phone}</td><td><span class="badge ${badge}">${status}</span></td><td>${new Date(d.lastActive).toLocaleTimeString()}</td></tr>`;
        });
    });

    // 2. Leaderboard (Client-Side Sorting to fix Index Error)
    if(unsubRank) unsubRank();
    const qRank = query(collection(db, "results"), where("testId", "==", tid));
    
    unsubRank = onSnapshot(qRank, (snap) => {
        let results = [];
        snap.forEach(doc => {
            const data = doc.data();
            data.docId = doc.id;
            results.push(data);
        });
        
        // Group by uid and keep only first attempt (earliest timestamp)
        const firstAttempts = {};
        results.forEach(r => {
            if (!firstAttempts[r.uid] || new Date(r.timestamp) < new Date(firstAttempts[r.uid].timestamp)) {
                firstAttempts[r.uid] = r;
            }
        });
        
        // Convert to array and sort DESC by score, then by time (faster is better)
        const leaderboard = Object.values(firstAttempts);
        leaderboard.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        const tbody = document.getElementById('rank-table');
        tbody.innerHTML = '';
        leaderboard.forEach((r, i) => {
            // Get student name and phone from result data (stored during submission)
            const studentName = r.studentName || r.email || 'Unknown';
            const studentPhone = r.studentPhone ? `<br><small style="color:var(--gray)">${r.studentPhone}</small>` : '';
            tbody.innerHTML += `<tr><td>#${i+1}</td><td>${studentName}${studentPhone}</td><td><strong>${r.score}</strong></td><td><button class="btn btn-outline" style="font-size:0.8rem; padding:4px 10px;" onclick="viewStudentResponse('${r.docId}')">📋 View</button></td></tr>`;
        });
    });
});

// MANAGE EXAMS
window.loadManageExams = async function() {
    const container = document.getElementById('exam-list-manage');
    container.innerHTML = '<p>Loading exams...</p>';
    
    try {
        const snap = await getDocs(collection(db, "tests"));
        container.innerHTML = '';
        
        if (snap.empty) {
            container.innerHTML = '<p style="text-align:center; color:var(--gray);">No exams created yet.</p>';
            return;
        }
        
        snap.forEach(d => {
            const exam = d.data();
            const examId = d.id;
            const isDisabled = exam.disabled || false;
            const resultsReleased = exam.resultsReleased !== false; // Default true for backward compatibility
            const expiryDate = exam.expiryDate ? new Date(exam.expiryDate).toLocaleString() : 'None';
            
            const card = document.createElement('div');
            card.className = 'question-card';
            card.style.marginBottom = '15px';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div style="flex:1;">
                        <h3 style="margin:0 0 10px 0;">${exam.title}</h3>
                        <div style="color:var(--gray); font-size:0.9rem;">
                            <div>📅 Created: ${new Date(exam.createdAt).toLocaleString()}</div>
                            <div>⏱️ Duration: ${exam.duration} minutes</div>
                            <div>🔁 Attempts: ${exam.attemptsAllowed || 1}</div>
                            <div>⏰ Expiry: ${expiryDate}</div>
                            <div>Status: <span style="color:${isDisabled ? 'var(--danger)' : 'var(--success)'}; font-weight:bold;">${isDisabled ? 'DISABLED' : 'ENABLED'}</span></div>
                            <div>Results: <span style="color:${resultsReleased ? 'var(--success)' : 'var(--warning)'}; font-weight:bold;">${resultsReleased ? '✅ RELEASED' : '⏳ PENDING'}</span></div>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <button class="btn btn-outline" onclick="editExam('${examId}')">✏️ Edit</button>
                        <button class="btn btn-outline" onclick="updateAnswers('${examId}')" style="border-color:var(--primary); color:var(--primary);">📝 Update Answers</button>
                        <button class="btn ${isDisabled ? 'btn-success' : 'btn-outline'}" onclick="toggleExamStatus('${examId}', ${!isDisabled})" style="${!isDisabled ? 'border-color:var(--warning); color:var(--warning);' : ''}">
                            ${isDisabled ? '✅ Enable' : '🚫 Disable'}
                        </button>
                        <button class="btn ${resultsReleased ? 'btn-outline' : 'btn-success'}" onclick="toggleResultsRelease('${examId}', ${!resultsReleased})" style="${resultsReleased ? 'border-color:var(--purple); color:var(--purple);' : ''}">
                            ${resultsReleased ? '🔒 Hide Results' : '📊 Release Results'}
                        </button>
                        <button class="btn btn-outline" onclick="deleteExam('${examId}')" style="border-color:var(--danger); color:var(--danger);">🗑️ Delete</button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch(err) {
        container.innerHTML = `<p style="color:var(--danger);">Error loading exams: ${err.message}</p>`;
    }
};

window.toggleExamStatus = async function(examId, newStatus) {
    try {
        await updateDoc(doc(db, "tests", examId), { disabled: newStatus });
        alert(`Exam ${newStatus ? 'disabled' : 'enabled'} successfully!`);
        loadManageExams();
        loadExamDropdown();
    } catch(err) {
        alert("Error: " + err.message);
    }
};

window.toggleResultsRelease = async function(examId, releaseStatus) {
    const confirmMsg = releaseStatus 
        ? "Release results? Students will be able to view their scores and answers."
        : "Hide results? Students will only see a pending message until results are released.";
    
    if (!confirm(confirmMsg)) return;
    
    try {
        await updateDoc(doc(db, "tests", examId), { resultsReleased: releaseStatus });
        alert(`Results ${releaseStatus ? 'released' : 'hidden'} successfully!`);
        loadManageExams();
    } catch(err) {
        alert("Error: " + err.message);
    }
};

window.editExam = async function(examId) {
    const newExpiry = prompt("Enter new expiry date/time (leave blank for none):\nFormat: YYYY-MM-DDTHH:MM");
    if (newExpiry === null) return; // User cancelled
    
    try {
        await updateDoc(doc(db, "tests", examId), { 
            expiryDate: newExpiry || null 
        });
        alert("Exam updated successfully!");
        loadManageExams();
    } catch(err) {
        alert("Error: " + err.message);
    }
};

window.updateAnswers = async function(examId) {
    try {
        const examSnap = await getDoc(doc(db, "tests", examId));
        if (!examSnap.exists()) {
            alert("Exam not found!");
            return;
        }
        
        const examData = examSnap.data();
        const currentQuestions = JSON.stringify(examData.questions, null, 2);
        
        const newQuestionsStr = prompt(
            "Update Question Data (JSON):\n\n" +
            "You can update answers, options, or any question field.\n" +
            "Current questions are pre-filled below.\n\n" +
            "Press OK to save changes:",
            currentQuestions
        );
        
        if (newQuestionsStr === null) return; // User cancelled
        
        try {
            const updatedQuestions = JSON.parse(newQuestionsStr);
            
            // Check if answers are complete now
            const stillHasMissingAnswers = checkMissingAnswers(updatedQuestions);
            const shouldAutoRelease = !stillHasMissingAnswers;
            
            // Update exam with new questions
            await updateDoc(doc(db, "tests", examId), {
                questions: updatedQuestions,
                resultsReleased: shouldAutoRelease
            });
            
            if (shouldAutoRelease) {
                // Recalculate all results for this exam
                await recalculateResults(examId, updatedQuestions);
                alert("✅ Answers updated and results released automatically!\n\nAll student scores have been recalculated.");
            } else {
                alert("⚠️ Answers updated but some questions still missing answers.\n\nResults remain PENDING.");
            }
            
            loadManageExams();
        } catch(parseErr) {
            alert("Invalid JSON format: " + parseErr.message);
        }
    } catch(err) {
        alert("Error: " + err.message);
    }
};

async function recalculateResults(testId, updatedQuestions) {
    try {
        const resultsSnap = await getDocs(query(collection(db, "results"), where("testId", "==", testId)));
        
        for (const resultDoc of resultsSnap.docs) {
            const resultData = resultDoc.data();
            const userAnswers = {};
            
            // Rebuild userAnswers from details
            resultData.details.forEach((detail, idx) => {
                userAnswers[idx] = detail.userAns;
            });
            
            // Recalculate score with new answer keys
            let newScore = 0;
            let newDetails = [];
            
            updatedQuestions.forEach((q, i) => {
                let uAns = userAnswers[i];
                if (q.type === 'multi' && (!uAns || uAns.length === 0)) uAns = null;
                if (q.type === 'passage' && (!uAns || Object.keys(uAns).length === 0)) uAns = null;
                if (uAns === undefined) uAns = null;
                
                let marks = 0;
                let isCorrect = false;
                
                if (uAns !== null) {
                    if (q.type === 'multi' && Array.isArray(uAns) && Array.isArray(q.answer)) {
                        const allCorrect = uAns.every(v => q.answer.includes(v));
                        const allAnswersSelected = uAns.length === q.answer.length && allCorrect;
                        
                        if (allAnswersSelected) {
                            marks = parseInt(q.marks || 4);
                            isCorrect = true;
                        } else if (allCorrect && uAns.length > 0) {
                            const correctCount = uAns.length;
                            const totalCorrect = q.answer.length;
                            marks = parseInt(q.marks || 4) * (correctCount / totalCorrect);
                            isCorrect = false;
                        } else {
                            marks = -parseInt(q.negativeMarks || 1);
                            isCorrect = false;
                        }
                    } else if (q.type === 'passage' && Array.isArray(q.questions)) {
                        marks = 0;
                    } else if (uAns == (q.answer ?? q.correct)) {
                        marks = parseInt(q.marks || 4);
                        isCorrect = true;
                    } else {
                        marks = -parseInt(q.negativeMarks || 1);
                    }
                }
                
                newScore += marks;
                newDetails.push({
                    qIdx: i,
                    userAns: uAns,
                    correct: q.answer ?? q.correct ?? null,
                    isCorrect,
                    marks,
                    time: resultData.details[i]?.time || 0
                });
            });
            
            // Update result with new score and details
            await updateDoc(doc(db, "results", resultDoc.id), {
                score: newScore,
                details: newDetails
            });
        }
    } catch(err) {
        console.error("Error recalculating results:", err);
    }
}

window.deleteExam = async function(examId) {
    if (!confirm("Are you sure you want to DELETE this exam? This action cannot be undone!")) return;
    
    try {
        await deleteDoc(doc(db, "tests", examId));
        alert("Exam deleted successfully!");
        loadManageExams();
        loadExamDropdown();
    } catch(err) {
        alert("Error: " + err.message);
    }
};

// VIEW STUDENT RESPONSES
window.viewStudentResponse = async function(resultId) {
    try {
        const resultSnap = await getDocs(query(collection(db, "results")));
        let resultData = null;
        
        resultSnap.forEach(doc => {
            if (doc.id === resultId) {
                resultData = doc.data();
                resultData.id = doc.id;
            }
        });
        
        if (!resultData) {
            alert("Result not found!");
            return;
        }
        
        // Fetch exam details
        const testSnap = await getDocs(collection(db, "tests"));
        let examData = null;
        testSnap.forEach(doc => {
            if (doc.id === resultData.testId) {
                examData = doc.data();
            }
        });
        
        if (!examData) {
            alert("Exam not found!");
            return;
        }
        
        renderStudentResponse(resultData, examData);
        switchTab('responses');
    } catch(err) {
        alert("Error loading response: " + err.message);
    }
};

function renderStudentResponse(resultData, examData) {
    const container = document.getElementById('response-content');
    
    let html = `
        <div class="question-card" style="margin-bottom:20px;">
            <h2>📊 Student Response Details</h2>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:15px; margin-top:15px;">
                <div><strong>Student:</strong> ${resultData.studentName || resultData.email}</div>
                <div><strong>Score:</strong> <span style="color:var(--primary); font-size:1.2rem; font-weight:bold;">${resultData.score}</span></div>
                <div><strong>WhatsApp:</strong> <a href="https://wa.me/91${resultData.studentPhone}" target="_blank" style="color:green; text-decoration:none;">📱 ${resultData.studentPhone || '-'}</a></div>
                <div><strong>Email:</strong> ${resultData.studentEmail || resultData.email || '-'}</div>
                <div><strong>Branch:</strong> ${resultData.studentBranch || '-'}</div>
                <div><strong>Exam:</strong> ${resultData.examTitle || examData.title}</div>
                <div><strong>Submitted:</strong> ${new Date(resultData.timestamp).toLocaleString()}</div>
                <div><strong>Total Time:</strong> ${Math.floor(resultData.totalTimeSpent / 60)}m ${Math.floor(resultData.totalTimeSpent % 60)}s</div>
            </div>
        </div>
    `;
    
    // Flatten questions for proper indexing (handle passage type)
    let flatQuestions = [];
    examData.questions.forEach(q => {
        if (q.type === 'passage' && Array.isArray(q.questions)) {
            q.questions.forEach(subQ => {
                flatQuestions.push({ ...subQ, passage: q.passage });
            });
        } else {
            flatQuestions.push(q);
        }
    });
    
    // Render each question with student's answer
    flatQuestions.forEach((q, idx) => {
        const detail = resultData.details && resultData.details[idx] ? resultData.details[idx] : {};
        const userAns = detail.userAns;
        const correctAns = detail.correct || q.answer || q.correct;
        const marks = detail.marks || 0;
        const isCorrect = detail.isCorrect;
        const timeSpent = detail.time || 0;
        
        let statusClass = marks > 0 ? 'bg-green' : marks < 0 ? 'bg-red' : 'bg-yellow';
        let statusText = marks > 0 ? `✓ Correct (+${marks})` : marks < 0 ? `✗ Wrong (${marks})` : '⊝ Skipped';
        
        html += `
            <div class="question-card" style="margin-bottom:15px; border-left:4px solid ${marks > 0 ? 'var(--success)' : marks < 0 ? 'var(--danger)' : 'var(--gray)'}">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <h3 style="margin:0;">Question ${idx + 1}</h3>
                    <div>
                        <span class="badge ${statusClass}" style="margin-right:10px;">${statusText}</span>
                        <span style="color:var(--gray); font-size:0.9rem;">⏱️ ${Math.floor(timeSpent)}s</span>
                    </div>
                </div>
        `;
        
        // Show passage if present
        if (q.passage) {
            html += `<div style="background:#f0f2f5; padding:10px; border-radius:4px; margin-bottom:10px; font-size:0.9rem;">${q.passage}</div>`;
        }
        
        html += `<div style="font-size:1.05rem; margin-bottom:15px;">${q.question || q.text}</div>`;
        
        // Show image if present
        if (q.img) {
            html += `<img src="${q.img}" style="max-width:100%; border-radius:4px; margin:10px 0;" />`;
        }
        
        // Display options and answers based on question type
        if (q.type === 'single' || q.type === 'multi') {
            html += '<div style="margin-top:10px;"><strong>Options:</strong></div>';
            html += '<div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">';
            
            q.options.forEach((opt, i) => {
                let optStyle = '';
                let optIcon = '';
                let optLabel = `${String.fromCharCode(65 + i)}. ${opt}`;
                
                const isUserAnswer = q.type === 'multi' 
                    ? (Array.isArray(userAns) && userAns.includes(i))
                    : (userAns === i);
                const isCorrectAnswer = Array.isArray(correctAns) 
                    ? correctAns.includes(i) 
                    : correctAns === i;
                
                // Priority: Correct answer shows green, wrong user answer shows red
                if (isCorrectAnswer) {
                    optStyle = 'background:#d4edda; border:2px solid #28a745; font-weight:bold;';
                    optIcon = '✓ ';
                } else if (isUserAnswer && !isCorrectAnswer) {
                    // Only show red if user selected wrong answer
                    optStyle = 'background:#f8d7da; border:2px solid #dc3545;';
                    optIcon = '✗ ';
                }
                
                html += `<div style="padding:10px; border:1px solid #ddd; border-radius:4px; ${optStyle}">${optIcon}${optLabel}</div>`;
            });
            
            html += '</div>';
        } else if (q.type === 'integer' || q.type === 'numerical') {
            html += `
                <div style="margin-top:10px;">
                    <div><strong>Student's Answer:</strong> <span style="color:${isCorrect ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">${userAns !== null && userAns !== undefined ? userAns : 'Not Answered'}</span></div>
                    <div><strong>Correct Answer:</strong> <span style="color:var(--success); font-weight:bold;">${correctAns}</span></div>
                </div>
            `;
        }
        
        // Show explanation if available
        if (q.explanation) {
            html += `
                <div style="margin-top:15px; padding:12px; background:#e8f4fd; border-left:4px solid var(--primary); border-radius:4px;">
                    <strong>💡 Explanation:</strong><br/>
                    ${q.explanation}
                </div>
            `;
        }
        
        html += '</div>';
    });
    
    container.innerHTML = html;
    
    // Trigger MathJax rendering if available
    if (window.MathJax) {
        MathJax.typesetPromise([container]).catch(err => console.log('MathJax error:', err));
    }
}

// --- REVIEW RESPONSES TAB ---
window.loadReviewExams = async function() {
    const select = document.getElementById('review-exam-select');
    select.innerHTML = '<option value="">-- Select Exam to Review --</option>';
    
    try {
        const testsSnap = await getDocs(collection(db, "tests"));
        testsSnap.forEach(doc => {
            const data = doc.data();
            // Only show exams with resultType = 'result'
            if (data.resultType === 'result') {
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.innerText = data.title;
                select.appendChild(opt);
            }
        });
    } catch(e) {
        console.error(e);
        alert('Error loading exams');
    }
};

window.loadStudentResponses = async function(examId) {
    if (!examId) {
        document.getElementById('review-content').innerHTML = '';
        return;
    }
    
    const container = document.getElementById('review-content');
    container.innerHTML = '<p>Loading responses...</p>';
    
    try {
        // Get exam data
        const examDoc = await getDoc(doc(db, "tests", examId));
        if (!examDoc.exists()) {
            container.innerHTML = '<p>Exam not found</p>';
            return;
        }
        
        const examData = examDoc.data();
        
        // Flatten questions
        let questions = [];
        if (examData.sections && Array.isArray(examData.sections)) {
            examData.sections.forEach(section => {
                if (Array.isArray(section.questions)) {
                    questions.push(...section.questions);
                }
            });
        } else if (Array.isArray(examData.questions)) {
            questions = examData.questions;
        }
        
        // Get all results for this exam
        const resultsSnap = await getDocs(query(collection(db, "results"), where("testId", "==", examId)));
        
        if (resultsSnap.empty) {
            container.innerHTML = '<p style="text-align:center; padding:40px; color:var(--gray);">No student responses yet.</p>';
            return;
        }
        
        const results = [];
        resultsSnap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            results.push(data);
        });
        
        // Store current exam ID for export
        document.getElementById('current-review-exam-id').value = examId;
        
        // Build Excel-like table
        let html = `
            <div style="margin-bottom:20px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <button class="btn btn-success" onclick="releaseAllResults('${examId}')">
                    <i class="fa fa-check"></i> Release All Results
                </button>
                <button class="btn btn-primary" onclick="exportToExcel()">
                    <i class="fa fa-file-excel"></i> Export to Excel
                </button>
                <span style="color:var(--gray); font-size:0.9rem;">Students with results released can see their qualification status</span>
            </div>
            
            <div style="overflow-x:auto;">
                <table style="width:100%; min-width:1200px; font-size:0.85rem;">
                    <thead>
                        <tr style="background:var(--primary); color:white;">
                            <th style="position:sticky; left:0; background:var(--primary); z-index:2;">Student Name</th>
                            <th>WhatsApp</th>
                            <th>Email</th>
                            <th>Branch</th>
                            <th>Score</th>`;
        
        // Add column for each question
        questions.forEach((q, i) => {
            const qText = (q.question || q.text || '').substring(0, 30);
            html += `<th title="${qText}">Q${i+1}</th>`;
        });
        
        html += `
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>`;
        
        // Add row for each student
        results.forEach(result => {
            const isQualified = result.qualified === true;
            const isNotQualified = result.qualified === false;
            const isPending = result.qualified === undefined || result.qualified === null;
            const isReleased = result.resultReleased === true;
            
            // Format WhatsApp link
            const whatsappLink = result.studentPhone ? 
                `<a href="https://wa.me/91${result.studentPhone}" target="_blank" style="color:green; text-decoration:none;">📱 ${result.studentPhone}</a>` : 
                '-';
            
            html += `
                <tr style="border-bottom:1px solid #ddd;">
                    <td style="position:sticky; left:0; background:white; font-weight:bold; border-right:2px solid #ddd;">${result.studentName || 'Unknown'}</td>
                    <td>${whatsappLink}</td>
                    <td style="font-size:0.8rem;">${result.studentEmail || result.email || '-'}</td>
                    <td style="font-size:0.8rem;">${result.studentBranch || '-'}</td>
                    <td style="font-weight:bold;">${result.score}</td>`;
            
            // Show each answer
            result.details.forEach((detail, i) => {
                let answerDisplay = '-';
                let bgColor = '#fff';
                
                if (detail.userAns !== null && detail.userAns !== undefined) {
                    if (Array.isArray(detail.userAns)) {
                        answerDisplay = detail.userAns.join(', ');
                    } else {
                        answerDisplay = detail.userAns;
                    }
                    
                    if (detail.isCorrect) {
                        bgColor = '#d4edda'; // Green
                    } else {
                        bgColor = '#f8d7da'; // Red
                    }
                }
                
                html += `<td style="background:${bgColor}; text-align:center;">${answerDisplay}</td>`;
            });
            
            // Status column
            let statusHTML = '';
            if (isReleased) {
                statusHTML = isQualified ? 
                    '<span style="color:green; font-weight:bold;">✅ Released: Qualified</span>' :
                    '<span style="color:red; font-weight:bold;">❌ Released: Not Qualified</span>';
            } else {
                if (isQualified) {
                    statusHTML = '<span style="color:orange; font-weight:bold;">⏳ Pending: Qualified</span>';
                } else if (isNotQualified) {
                    statusHTML = '<span style="color:orange; font-weight:bold;">⏳ Pending: Not Qualified</span>';
                } else {
                    statusHTML = '<span style="color:gray;">⏳ Not Reviewed</span>';
                }
            }
            html += `<td>${statusHTML}</td>`;
            
            // Actions column
            html += `
                <td>
                    <select onchange="markStudent('${result.id}', this.value)" style="padding:5px; font-size:0.85rem;">
                        <option value="">-- Mark As --</option>
                        <option value="qualified" ${isQualified ? 'selected' : ''}>Qualified</option>
                        <option value="not-qualified" ${isNotQualified ? 'selected' : ''}>Not Qualified</option>
                    </select>
                </td>
            </tr>`;
        });
        
        html += `
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top:20px; padding:15px; background:#f8f9fa; border-radius:6px;">
                <h4>Instructions:</h4>
                <ol style="margin:0; padding-left:20px;">
                    <li>Green cells = Correct answer, Red cells = Wrong answer</li>
                    <li>Use "Mark As" dropdown to mark each student as Qualified or Not Qualified</li>
                    <li>Click "Release All Results" button to make results visible to all students</li>
                    <li>Students can only see their qualification status (not detailed answers)</li>
                </ol>
            </div>
        `;
        
        container.innerHTML = html;
        
    } catch(e) {
        console.error(e);
        container.innerHTML = `<p style="color:red;">Error: ${e.message}</p>`;
    }
};

window.markStudent = async function(resultId, status) {
    if (!status) return;
    
    try {
        const qualified = status === 'qualified';
        await updateDoc(doc(db, "results", resultId), {
            qualified: qualified,
            reviewedAt: new Date().toISOString()
        });
        alert(`✅ Student marked as ${qualified ? 'Qualified' : 'Not Qualified'}`);
    } catch(e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
};

window.releaseAllResults = async function(examId) {
    if (!confirm('Are you sure you want to release results to ALL students for this exam?\n\nStudents will be able to see their qualification status.')) {
        return;
    }
    
    try {
        const resultsSnap = await getDocs(query(collection(db, "results"), where("testId", "==", examId)));
        
        const promises = [];
        resultsSnap.forEach(doc => {
            promises.push(updateDoc(doc.ref, {
                resultReleased: true,
                releasedAt: new Date().toISOString()
            }));
        });
        
        await Promise.all(promises);
        
        alert(`✅ Results released for ${promises.length} student(s)!`);
        
        // Reload the table
        loadStudentResponses(examId);
        
    } catch(e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
};

// --- EXPORT TO EXCEL FUNCTION ---
window.exportToExcel = async function() {
    const examId = document.getElementById('current-review-exam-id').value;
    
    if (!examId) {
        alert('Please select an exam first');
        return;
    }
    
    try {
        // Get exam data
        const examDoc = await getDoc(doc(db, "tests", examId));
        if (!examDoc.exists()) {
            alert('Exam not found');
            return;
        }
        
        const examData = examDoc.data();
        
        // Flatten questions
        let questions = [];
        if (examData.sections && Array.isArray(examData.sections)) {
            examData.sections.forEach(section => {
                if (Array.isArray(section.questions)) {
                    questions.push(...section.questions);
                }
            });
        } else if (Array.isArray(examData.questions)) {
            questions = examData.questions;
        }
        
        // Get all results for this exam
        const resultsSnap = await getDocs(query(collection(db, "results"), where("testId", "==", examId)));
        
        if (resultsSnap.empty) {
            alert('No student responses to export');
            return;
        }
        
        const results = [];
        resultsSnap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            results.push(data);
        });
        
        // Prepare data for Excel
        const excelData = [];
        
        // Header row
        const headers = [
            'Student Name',
            'WhatsApp',
            'Email',
            'Branch',
            'Total Score'
        ];
        
        // Add question headers - just question numbers
        questions.forEach((q, i) => {
            headers.push(`Q${i+1}`);
        });
        
        headers.push('Qualification Status', 'Result Released', 'Submitted At');
        
        excelData.push(headers);
        
        // Data rows
        results.forEach(result => {
            const row = [
                result.studentName || 'Unknown',
                result.studentPhone || '-',
                result.studentEmail || result.email || '-',
                result.studentBranch || '-',
                result.score || 0
            ];
            
            // Add answers for each question - just show answer with green/red color indicator
            result.details.forEach(detail => {
                let answerDisplay = '-';
                if (detail.userAns !== null && detail.userAns !== undefined) {
                    if (Array.isArray(detail.userAns)) {
                        // Convert array of indices to 1-based options
                        answerDisplay = detail.userAns.map(idx => idx + 1).join(', ');
                    } else if (typeof detail.userAns === 'number') {
                        // Convert single index to 1-based option
                        answerDisplay = detail.userAns + 1;
                    } else {
                        // For text/numerical answers, keep as is
                        answerDisplay = detail.userAns;
                    }
                }
                row.push(answerDisplay);
            });
            
            // Status
            let qualStatus = 'Pending Review';
            if (result.qualified === true) qualStatus = 'Qualified';
            if (result.qualified === false) qualStatus = 'Not Qualified';
            
            row.push(
                qualStatus,
                result.resultReleased ? 'Yes' : 'No',
                result.timestamp ? new Date(result.timestamp).toLocaleString() : '-'
            );
            
            excelData.push(row);
        });
        
        // Create workbook and worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        
        // Set column widths
        const colWidths = headers.map((h, i) => {
            if (i < 9) return { wch: 15 }; // Student info columns
            if (h.startsWith('Q')) return { wch: 12 }; // Question columns
            return { wch: 20 }; // Status columns
        });
        ws['!cols'] = colWidths;
        
        // Apply cell colors based on correct/incorrect answers
        const range = XLSX.utils.decode_range(ws['!ref']);
        
        for (let R = 1; R <= range.e.r; R++) { // Start from 1 to skip header
            results.forEach((result, resultIdx) => {
                if (R === resultIdx + 1) { // Match row with result
                    result.details.forEach((detail, qIdx) => {
                        const colIdx = 9 + qIdx; // Question columns start at index 9
                        const cellAddress = XLSX.utils.encode_cell({ r: R, c: colIdx });
                        
                        if (ws[cellAddress]) {
                            // Apply color based on correctness
                            if (detail.isCorrect) {
                                // Green for correct
                                ws[cellAddress].s = {
                                    font: { color: { rgb: "008000" }, bold: true },
                                    fill: { fgColor: { rgb: "D4EDDA" } }
                                };
                            } else if (detail.userAns !== null && detail.userAns !== undefined) {
                                // Red for incorrect
                                ws[cellAddress].s = {
                                    font: { color: { rgb: "FF0000" }, bold: true },
                                    fill: { fgColor: { rgb: "F8D7DA" } }
                                };
                            } else {
                                // Gray for not attempted
                                ws[cellAddress].s = {
                                    font: { color: { rgb: "666666" } },
                                    fill: { fgColor: { rgb: "F0F0F0" } }
                                };
                            }
                        }
                    });
                }
            });
        }
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Student Responses');
        
        // Generate filename
        const examTitle = examData.title || 'Exam';
        const filename = `${examTitle}_Responses_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        // Download file
        XLSX.writeFile(wb, filename);
        
        console.log('Excel file exported successfully');
        
    } catch (error) {
        console.error('Export Error:', error);
        alert('Error exporting to Excel: ' + error.message);
    }
};