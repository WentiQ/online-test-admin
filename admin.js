import { db } from './config.js';
import { collection, addDoc, getDocs, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
        snap.forEach(doc => results.push(doc.data()));
        
        // Sort DESC by score
        results.sort((a, b) => b.score - a.score);

        const tbody = document.getElementById('rank-table');
        tbody.innerHTML = '';
        results.forEach((r, i) => {
            tbody.innerHTML += `<tr><td>#${i+1}</td><td>${r.email}</td><td><strong>${r.score}</strong></td></tr>`;
        });
    });
});