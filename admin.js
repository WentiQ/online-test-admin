import { db } from './config.js';
import { collection, addDoc, getDocs, query, where, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CREATE EXAM ---
document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.innerText = "Publishing...";

    try {
        const questions = JSON.parse(document.getElementById('json-input').value);
        await addDoc(collection(db, "tests"), {
            title: document.getElementById('title').value,
            startTime: document.getElementById('startTime').value, // ISO String
            endTime: document.getElementById('endTime').value,     // ISO String
            duration: parseInt(document.getElementById('duration').value),
            attemptsAllowed: parseInt(document.getElementById('attempts').value),
            questions: questions,
            createdAt: new Date().toISOString()
        });
        alert("Exam Published!");
        e.target.reset();
        loadExamDropdown(); // Refresh dropdown
    } catch(err) {
        alert("Error: " + err.message);
    }
    btn.disabled = false; btn.innerText = "Publish Exam";
});

// --- MONITORING ---
const examSelect = document.getElementById('exam-select');
let unsubscribeLive = null;
let unsubscribeRanks = null;

async function loadExamDropdown() {
    const snap = await getDocs(collection(db, "tests"));
    examSelect.innerHTML = '<option value="">-- Choose Active Exam --</option>';
    snap.forEach(doc => {
        const d = doc.data();
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.innerText = d.title;
        examSelect.appendChild(opt);
    });
}
loadExamDropdown();

examSelect.addEventListener('change', (e) => {
    const testId = e.target.value;
    if (!testId) return;

    // 1. Listen for LIVE STATUS (Students currently taking it)
    if (unsubscribeLive) unsubscribeLive();
    const qLive = query(collection(db, "live_status"), where("testId", "==", testId));
    
    unsubscribeLive = onSnapshot(qLive, (snap) => {
        const tbody = document.getElementById('live-table');
        tbody.innerHTML = '';
        snap.forEach(doc => {
            const d = doc.data();
            let badgeClass = 'bg-yellow';
            if (d.status === 'Completed') badgeClass = 'bg-green';
            if (d.status === 'Disqualified') badgeClass = 'bg-red';
            
            tbody.innerHTML += `
                <tr>
                    <td>${d.name || 'Student'}</td>
                    <td><span class="badge ${badgeClass}">${d.status}</span></td>
                    <td>${new Date(d.lastActive).toLocaleTimeString()}</td>
                </tr>
            `;
        });
    });

    // 2. Listen for RESULTS (Leaderboard)
    if (unsubscribeRanks) unsubscribeRanks();
    const qRanks = query(collection(db, "results"), where("testId", "==", testId), orderBy("score", "desc"));

    unsubscribeRanks = onSnapshot(qRanks, (snap) => {
        const tbody = document.getElementById('rank-table');
        tbody.innerHTML = '';
        let rank = 1;
        snap.forEach(doc => {
            const d = doc.data();
            tbody.innerHTML += `
                <tr>
                    <td>#${rank++}</td>
                    <td>${d.email}</td>
                    <td><strong>${d.score}</strong></td>
                </tr>
            `;
        });
    });
});