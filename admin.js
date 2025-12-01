import { db } from './config.js';
import { collection, addDoc, getDocs, query, where, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// CREATE EXAM
document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.innerText = "Publishing...";

    try {
        const questions = JSON.parse(document.getElementById('json-input').value);
        await addDoc(collection(db, "tests"), {
            title: document.getElementById('title').value,
            startTime: document.getElementById('startTime').value,
            endTime: document.getElementById('endTime').value,
            duration: parseInt(document.getElementById('duration').value),
            attemptsAllowed: parseInt(document.getElementById('attempts').value),
            questions: questions,
            createdAt: new Date().toISOString(),
            expiryDate: document.getElementById('expiryDate').value || null,
            disabled: document.getElementById('disabled').checked
        });
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
            
            tbody.innerHTML += `<tr><td>${d.name}</td><td><span class="badge ${badge}">${status}</span></td><td>${new Date(d.lastActive).toLocaleTimeString()}</td></tr>`;
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
            // Get student name from result data (stored during submission)
            const studentName = r.studentName || r.email || 'Unknown';
            tbody.innerHTML += `<tr><td>#${i+1}</td><td>${studentName}</td><td><strong>${r.score}</strong></td></tr>`;
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
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <button class="btn btn-outline" onclick="editExam('${examId}')">✏️ Edit</button>
                        <button class="btn ${isDisabled ? 'btn-success' : 'btn-outline'}" onclick="toggleExamStatus('${examId}', ${!isDisabled})" style="${!isDisabled ? 'border-color:var(--warning); color:var(--warning);' : ''}">
                            ${isDisabled ? '✅ Enable' : '🚫 Disable'}
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