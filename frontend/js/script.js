const API = "http://localhost:5000/api";

let currentJobId = null;
let savedJobIds = new Set();

// ----------------------------------
// BASIC HELPERS
// ----------------------------------

function getToken() {
    return localStorage.getItem("token");
}

function getUser() {
    const data = localStorage.getItem("user");

    return data ? JSON.parse(data) : null;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (char) {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return replacements[char];
    });
}

async function request(url, options = {}) {
    const headers = {
        ...(options.headers || {})
    };

    if (getToken()) {
        headers.Authorization = "Bearer " + getToken();
    }

    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(API + url, {
        ...options,
        headers
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "Request failed");
    }

    return data;
}

// ======================================
// PHASE 13: SMART MATCHING
// ======================================
function showSmartJobs() {
    const user = getUser(); if (!user || user.role !== "seeker") { alert("Please log in as a job seeker."); showLogin(); return; }
    hideAllPages(); document.getElementById("smartJobsPage").classList.remove("hidden"); loadSmartJobs();
}
async function loadSmartJobs() {
    const container = document.getElementById("smartJobsResults"); if (!container) return; container.innerHTML = "<p>Calculating job matches...</p>";
    try { const data = await request("/seeker/recommended-jobs"); const rows = data.recommendations || [];
        if (!rows.length) { container.innerHTML = "<p>No jobs available to match yet.</p>"; return; }
        container.innerHTML = rows.map(job => { const match = job.match || {}; const score = Number(match.score || 0); const matched = match.matched_skills || []; const missing = match.missing_skills || [];
            return `<article class="smart-match-card"><div class="smart-score">${score}% Match</div><h3>${escapeHTML(job.job_title || "Job")}</h3><p><strong>${escapeHTML(job.company_name || "Company")}</strong> · ${escapeHTML(job.location || "Location not specified")}</p><div class="smart-score-bar"><span style="width:${Math.max(0,Math.min(100,score))}%"></span></div><p><strong>Matched skills:</strong> ${matched.length ? matched.map(escapeHTML).join(", ") : "No direct skill match"}</p><p><strong>Skills to improve:</strong> ${missing.length ? missing.map(escapeHTML).join(", ") : "No listed skill gaps"}</p><p><strong>Match basis:</strong> Skills 70%, experience 20%, education 10% (adjusted when requirements are missing).</p><button onclick="viewJob(${Number(job.id)})">View Job</button></article>`;
        }).join("");
    } catch (e) { container.innerHTML = `<p class="error-message">${escapeHTML(e.message)}</p>`; }
}
function showSmartCandidates() { if (!recruiterOnly()) return; hideAllPages(); document.getElementById("smartCandidatesPage").classList.remove("hidden"); loadSmartCandidateJobs(); }
async function loadSmartCandidateJobs() {
    const select = document.getElementById("smartCandidateJob");
    const results = document.getElementById("smartCandidateResults");
    if (!select) return;
    select.innerHTML = '<option value="">Loading your jobs...</option>';
    select.disabled = true;
    if (results) results.innerHTML = '<p>Select a job after the list loads.</p>';
    try {
        const data = await request("/applications/recruiter/jobs");
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        select.innerHTML = jobs.length
            ? '<option value="">Select a job</option>' + jobs.map(j => `<option value="${Number(j.id)}">${escapeHTML(j.job_title)} — ${escapeHTML(j.company_name || "Company")}</option>`).join("")
            : '<option value="">No jobs posted yet</option>';
        select.disabled = jobs.length === 0;
        if (results) results.innerHTML = jobs.length ? '<p>Select a job and click Find Matches.</p>' : '<p>You have no jobs posted yet. Create a job first.</p>';
    } catch (e) {
        select.innerHTML = '<option value="">Unable to load jobs</option>';
        select.disabled = false;
        if (results) results.innerHTML = `<p class="error-message">${escapeHTML(e.message)}</p>`;
    }
}
async function loadSmartCandidates() { if (!recruiterOnly()) return; const jobId = Number(document.getElementById("smartCandidateJob").value); const container=document.getElementById("smartCandidateResults"); if (!jobId) { container.innerHTML="<p>Please select a job first.</p>"; return; } container.innerHTML="<p>Ranking candidates...</p>"; try { const data=await request(`/recruiter/smart-candidates?job_id=${jobId}`); const candidates=data.candidates||[]; if(!candidates.length){container.innerHTML="<p>No seeker profiles available.</p>";return;} container.innerHTML=candidates.map(c=>{const m=c.match||{}; const score=Math.max(0,Math.min(100,Number(m.score||0))); return `<article class="smart-match-card"><div class="smart-score">${score}% Match</div><h3>${escapeHTML(c.full_name||"Candidate")}</h3><p>${escapeHTML(c.education||"Education not provided")}${c.graduation_year?" · "+escapeHTML(c.graduation_year):""}</p><p><strong>Experience:</strong> ${escapeHTML(c.experience||"Not provided")}</p><div class="smart-score-bar"><span style="width:${score}%"></span></div><p><strong>Matched skills:</strong> ${(m.matched_skills||[]).length?(m.matched_skills||[]).map(escapeHTML).join(", "):"No direct match"}</p><p><strong>Missing skills:</strong> ${(m.missing_skills||[]).length?(m.missing_skills||[]).map(escapeHTML).join(", "):"No listed skill gaps"}</p><div class="candidate-actions"><button class="secondary-btn" onclick="viewCandidateProfile(${Number(c.id)})">View Profile</button><button onclick="addCandidateToShortlist(${Number(c.id)})">Shortlist</button></div></article>`; }).join(""); } catch(e) { container.innerHTML=`<p class="error-message">${escapeHTML(e.message)}</p>`; } }

// ======================================
// PHASE 14: CAREER INTELLIGENCE
// ======================================
function showCareerIntelligence() {
    const user = getUser();
    if (!user || user.role !== "seeker") { alert("Please log in as a job seeker."); showLogin(); return; }
    hideAllPages();
    document.getElementById("careerIntelligencePage").classList.remove("hidden");
    loadCareerIntelligence();
}
async function loadCareerIntelligence() {
    const summaryBox = document.getElementById("careerIntelSummary");
    const jobsBox = document.getElementById("careerIntelJobs");
    const roadmapBox = document.getElementById("careerIntelRoadmap");
    if (!summaryBox || !jobsBox || !roadmapBox) return;
    summaryBox.innerHTML = "<p>Analyzing your profile...</p>"; jobsBox.innerHTML = "<p>Finding recommendations...</p>"; roadmapBox.innerHTML = "<p>Building skill roadmap...</p>";
    try {
        const data = await request("/seeker/career-intelligence");
        const profile = data.profile || {}, skills = profile.skills || [], recs = data.recommendations || [], gaps = data.skill_gaps || [], roadmap = data.roadmap || [];
        summaryBox.innerHTML = `<article class="career-intel-stat"><strong>${skills.length}</strong><span>Profile skills</span></article><article class="career-intel-stat"><strong>${recs.length}</strong><span>Job recommendations</span></article><article class="career-intel-stat"><strong>${gaps.length}</strong><span>Skill gaps</span></article><article class="career-intel-skills"><h3>Your profile skills</h3>${skills.length ? skills.map(skill => `<span class="career-skill-chip">${escapeHTML(skill)}</span>`).join("") : "<p>Add skills to your profile for better recommendations.</p>"}</article>`;
        jobsBox.innerHTML = recs.length ? recs.map(job => { const m = job.match || {}, score = Math.max(0, Math.min(100, Number(m.score || 0))); return `<article class="smart-match-card"><div class="smart-score">${score}% Match</div><h3>${escapeHTML(job.job_title || "Job")}</h3><p><strong>${escapeHTML(job.company_name || "Company")}</strong> · ${escapeHTML(job.location || "Location not specified")}</p><div class="smart-score-bar"><span style="width:${score}%"></span></div><p><strong>Matched skills:</strong> ${(m.matched_skills || []).map(escapeHTML).join(", ") || "No direct skill match"}</p><p><strong>Skills to improve:</strong> ${(m.missing_skills || []).map(escapeHTML).join(", ") || "No listed gaps"}</p><button onclick="viewJob(${Number(job.id)})">View Job</button></article>`; }).join("") : "<p>No job recommendations yet. Jobs will appear when recruiters post them.</p>";
        roadmapBox.innerHTML = roadmap.length ? roadmap.map(item => `<article class="career-roadmap-item"><div><span class="career-priority ${String(item.priority || "").toLowerCase()}">${escapeHTML(item.priority || "Suggested")}</span><h3>${escapeHTML(item.skill)}</h3><p>${escapeHTML(item.suggested_action || "")}</p><small>Appears in ${Number(item.demand || 0)} job requirement sets</small></div></article>`).join("") : "<p>No skill gaps found from current job requirements. Keep practicing and update your profile.</p>";
    } catch (error) { const msg = escapeHTML(error.message); summaryBox.innerHTML = `<p class="error-message">${msg}</p>`; jobsBox.innerHTML = `<p class="error-message">${msg}</p>`; roadmapBox.innerHTML = `<p class="error-message">${msg}</p>`; }
}

// ======================================
// PHASE 8: CANDIDATE SEARCH & SHORTLIST
// ======================================
function recruiterOnly() {
    const user = getUser();
    if (!user || user.role !== "recruiter") { alert("Please log in as a recruiter to access candidates."); showLogin(); return false; }
    return true;
}
function showCandidateSearch() { if (!recruiterOnly()) return; hideAllPages(); document.getElementById("candidateSearchPage").classList.remove("hidden"); searchCandidates(); }
function resetCandidateSearch() { document.getElementById("candidateSearchInput").value = ""; document.getElementById("candidateSkillFilter").value = ""; document.getElementById("candidateEducationFilter").value = ""; searchCandidates(); }
async function searchCandidates() {
    if (!recruiterOnly()) return;
    const query = new URLSearchParams({ search: document.getElementById("candidateSearchInput").value.trim(), skill: document.getElementById("candidateSkillFilter").value.trim(), education: document.getElementById("candidateEducationFilter").value.trim() });
    const container = document.getElementById("candidateResults"); container.innerHTML = "<p>Searching candidates...</p>";
    try { const data = await request("/recruiter/candidates?" + query.toString()); const candidates = data.candidates || []; document.getElementById("candidateResultsInfo").textContent = candidates.length + " candidate(s) found"; renderCandidateCards(candidates, container, false); }
    catch (error) { container.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`; }
}
function renderCandidateCards(candidates, container, shortlistMode) {
    if (!candidates.length) { container.innerHTML = "<p>No candidates found.</p>"; return; }
    container.innerHTML = candidates.map(candidate => {
        const skills = String(candidate.skills || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        const action = shortlistMode ? `<button class="secondary-btn" onclick="removeCandidateFromShortlist(${Number(candidate.id)})">Remove</button>` : (candidate.is_shortlisted ? `<button class="secondary-btn" onclick="removeCandidateFromShortlist(${Number(candidate.id)})">Shortlisted ✓</button>` : `<button onclick="addCandidateToShortlist(${Number(candidate.id)})">Shortlist</button>`);
        return `<article class="candidate-card"><div class="candidate-card-top"><div class="candidate-avatar">${escapeHTML((candidate.full_name || "C").trim().charAt(0).toUpperCase())}</div><div><h3>${escapeHTML(candidate.full_name || "Candidate")}</h3><span class="candidate-education">${escapeHTML(candidate.education || "Education not provided")}${candidate.graduation_year ? " · " + escapeHTML(candidate.graduation_year) : ""}</span></div>${candidate.professional_summary ? `<p>${escapeHTML(candidate.professional_summary)}</p>` : ""}${candidate.experience ? `<p><strong>Experience:</strong> ${escapeHTML(candidate.experience)}</p>` : ""}<div class="candidate-skills">${skills.length ? skills.slice(0,12).map(skill => `<span>${escapeHTML(skill)}</span>`).join("") : `<span>Skills not provided</span>`}</div><p class="resume-indicator">${Number(candidate.has_resume) ? "Resume available (access through an application if permitted)" : "Resume not uploaded"}</p><div class="candidate-actions"><button class="secondary-btn" onclick="viewCandidateProfile(${Number(candidate.id)})">View Full Profile</button>${action}</div></article>`;
    }).join("");
}
async function viewCandidateProfile(candidateId) {
    if (!recruiterOnly()) return;
    const modal = document.getElementById("candidateProfileModal");
    const content = document.getElementById("candidateProfileContent");
    modal.classList.remove("hidden"); content.innerHTML = "<p>Loading candidate profile...</p>";
    try {
        const data = await request(`/recruiter/candidates/${Number(candidateId)}/profile`);
        const p = data.profile || {};
        const skills = String(p.skills || "").split(/[\,\n]/).map(v => v.trim()).filter(Boolean);
        content.innerHTML = `<div class="candidate-profile-detail"><h3>${escapeHTML(p.full_name || "Candidate")}</h3><p><strong>Email:</strong> ${escapeHTML(p.email || "Not provided")}</p><p><strong>Phone:</strong> ${escapeHTML(p.phone || "Not provided")}</p><p><strong>Education:</strong> ${escapeHTML(p.education || "Not provided")}${p.graduation_year ? " · " + escapeHTML(p.graduation_year) : ""}</p><p><strong>Experience:</strong> ${escapeHTML(p.experience || "Not provided")}</p><p><strong>Professional Summary:</strong></p><p>${escapeHTML(p.professional_summary || "Not provided")}</p><h4>Skills</h4><div class="candidate-skills">${skills.length ? skills.map(skill => `<span>${escapeHTML(skill)}</span>`).join("") : "Skills not provided"}</div><p><strong>Resume:</strong> ${Number(p.has_resume) ? "Available through an eligible application" : "Not uploaded"}</p></div>`;
    } catch (error) { content.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`; }
}
function closeCandidateProfile() { const modal = document.getElementById("candidateProfileModal"); if (modal) modal.classList.add("hidden"); }
async function addCandidateToShortlist(candidateId) { if (!recruiterOnly()) return; try { await request(`/recruiter/shortlist/${candidateId}`, { method: "POST" }); alert("Candidate added to shortlist"); searchCandidates(); } catch (error) { alert(error.message); } }
async function removeCandidateFromShortlist(candidateId) { if (!recruiterOnly()) return; try { await request(`/recruiter/shortlist/${candidateId}`, { method: "DELETE" }); if (!document.getElementById("recruiterShortlistPage").classList.contains("hidden")) showRecruiterShortlist(); else searchCandidates(); } catch (error) { alert(error.message); } }
async function showRecruiterShortlist() { if (!recruiterOnly()) return; hideAllPages(); document.getElementById("recruiterShortlistPage").classList.remove("hidden"); const container = document.getElementById("shortlistResults"); container.innerHTML = "<p>Loading shortlist...</p>"; try { const data = await request("/recruiter/shortlist"); renderCandidateCards(data.candidates || [], container, true); } catch (error) { container.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`; } }

// ======================================
// PHASE 9: INTERVIEW MANAGEMENT
// ======================================
async function showInterviewManagement() {
    if (!recruiterOnly()) return;
    hideAllPages(); document.getElementById("interviewsPage").classList.remove("hidden");
    await loadInterviewApplications(); await loadRecruiterInterviews();
}
async function loadInterviewApplications() {
    const select = document.getElementById("interviewApplication"); select.innerHTML = '<option value="">Loading applications...</option>';
    try { const data = await request("/recruiter/interview-applications"); const rows = data.applications || [];
        select.innerHTML = '<option value="">Select candidate / job application</option>' + rows.map(row => `<option value="${Number(row.application_id)}">${escapeHTML(row.full_name)} — ${escapeHTML(row.job_title)} (Application #${Number(row.application_id)})</option>`).join("");
        if (!rows.length) select.innerHTML = '<option value="">No applications found for your jobs</option>';
    } catch (error) { select.innerHTML = '<option value="">Unable to load applications</option>'; alert(error.message); }
}
async function scheduleInterview(event) {
    event.preventDefault(); if (!recruiterOnly()) return;
    const payload = { application_id: Number(document.getElementById("interviewApplication").value), scheduled_at: document.getElementById("interviewDateTime").value, interview_type: document.getElementById("interviewType").value, meeting_link: document.getElementById("interviewMeetingLink").value.trim(), notes: document.getElementById("interviewNotes").value.trim() };
    try { await request("/recruiter/interviews", { method: "POST", body: JSON.stringify(payload) }); alert("Interview scheduled successfully"); document.getElementById("interviewForm").reset(); await loadRecruiterInterviews(); } catch (error) { alert(error.message); }
}
async function loadRecruiterInterviews() {
    const container = document.getElementById("interviewList"); if (!container) return; container.innerHTML = "<p>Loading interviews...</p>";
    try { const data = await request("/recruiter/interviews"); const rows = data.interviews || []; if (!rows.length) { container.innerHTML = "<p>No interviews scheduled yet.</p>"; return; }
        container.innerHTML = rows.map(row => { const date = new Date(row.scheduled_at); const dateText = Number.isNaN(date.getTime()) ? escapeHTML(row.scheduled_at) : escapeHTML(date.toLocaleString()); return `<article class="interview-card"><div class="interview-card-head"><div><h3>${escapeHTML(row.full_name)}</h3><p>${escapeHTML(row.job_title)} · ${escapeHTML(row.email)}</p></div><span class="interview-status">${escapeHTML(row.status)}</span></div><p><strong>Date:</strong> ${dateText}</p><p><strong>Type:</strong> ${escapeHTML(row.interview_type)}</p>${row.meeting_link ? `<p><strong>Meeting:</strong> <a href="${escapeHTML(row.meeting_link)}" target="_blank" rel="noopener noreferrer">Open meeting link</a></p>` : ""}${row.notes ? `<p><strong>Notes:</strong> ${escapeHTML(row.notes)}</p>` : ""}<div class="interview-actions"><select id="interviewStatus_${Number(row.id)}"><option ${row.status === "Scheduled" ? "selected" : ""}>Scheduled</option><option ${row.status === "Completed" ? "selected" : ""}>Completed</option><option ${row.status === "Cancelled" ? "selected" : ""}>Cancelled</option><option ${row.status === "Rescheduled" ? "selected" : ""}>Rescheduled</option></select><button class="secondary-btn" onclick="updateInterviewStatus(${Number(row.id)})">Update Status</button><button class="danger-btn" onclick="deleteInterview(${Number(row.id)})">Delete</button></div></article>`; }).join("");
    } catch (error) { container.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`; }
}
async function updateInterviewStatus(id) { const status = document.getElementById(`interviewStatus_${id}`).value; try { await request(`/recruiter/interviews/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); await loadRecruiterInterviews(); } catch (error) { alert(error.message); } }
async function deleteInterview(id) { if (!confirm("Delete this interview?")) return; try { await request(`/recruiter/interviews/${id}`, { method: "DELETE" }); await loadRecruiterInterviews(); } catch (error) { alert(error.message); } }

// ======================================
// PHASE 12: RECRUITMENT PIPELINE UI
// ======================================
const PIPELINE_STAGES = ["Applied", "Shortlisted", "Interview", "Selected", "Hired", "Rejected"];
async function showRecruiterPipeline() { if (!recruiterOnly()) return; hideAllPages(); document.getElementById("recruiterPipelinePage").classList.remove("hidden"); await loadPipelineJobs(); await loadRecruiterPipeline(); }
async function loadPipelineJobs() { const select = document.getElementById("pipelineJobFilter"); if (!select || select.dataset.loaded === "1") return; try { const data = await request("/applications/recruiter/jobs"); (data.jobs || []).forEach(job => { const opt = document.createElement("option"); opt.value = job.id; opt.textContent = `${job.job_title} — ${job.company_name || "Company"}`; select.appendChild(opt); }); select.dataset.loaded = "1"; } catch (e) { console.warn("Pipeline job filters:", e.message); } }
async function loadRecruiterPipeline() { const board = document.getElementById("pipelineBoard"); if (!board) return; board.innerHTML = "<p>Loading pipeline...</p>"; try { const q = new URLSearchParams({search: document.getElementById("pipelineSearch")?.value || "", job: document.getElementById("pipelineJobFilter")?.value || "", status: document.getElementById("pipelineStatusFilter")?.value || ""}); const data = await request("/recruiter/pipeline?" + q); const apps = data.applications || []; const summary = document.getElementById("pipelineSummary"); summary.innerHTML = PIPELINE_STAGES.map(stage => `<div class="pipeline-summary-item"><span>${escapeHTML(stage)}</span><strong>${apps.filter(a => (a.status || "Applied") === stage).length}</strong></div>`).join(""); board.innerHTML = PIPELINE_STAGES.map(stage => { const rows = apps.filter(a => (a.status || "Applied") === stage); return `<section class="pipeline-column"><header><h3>${escapeHTML(stage)}</h3><span>${rows.length}</span></header>${rows.length ? rows.map(a => `<article class="pipeline-card"><h4>${escapeHTML(a.full_name || "Candidate")}</h4><p class="pipeline-job">${escapeHTML(a.job_title)} · ${escapeHTML(a.company_name || "")}</p><p>${escapeHTML(a.email || "")}</p><p class="pipeline-skills">${escapeHTML(a.skills || "Skills not listed")}</p><label>Move stage<select id="pipelineStage_${Number(a.application_id)}">${PIPELINE_STAGES.map(s => `<option ${s === (a.status || "Applied") ? "selected" : ""}>${escapeHTML(s)}</option>`).join("")}</select></label><button onclick="updatePipelineStage(${Number(a.application_id)})">Update stage</button><button class="secondary-btn" onclick="viewCandidateProfile(${Number(a.applicant_id)})">Full Profile</button><button class="secondary-btn" onclick="showPipelineActivity(${Number(a.application_id)})">Activity</button></article>`).join("") : `<p class="pipeline-empty">No candidates</p>`}</section>`; }).join(""); } catch (error) { board.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`; } }
async function updatePipelineStage(applicationId) { const stage = document.getElementById(`pipelineStage_${applicationId}`).value; try { await request(`/applications/${applicationId}/status`, {method:"PUT", body:JSON.stringify({status:stage})}); await loadRecruiterPipeline(); refreshNotificationCount(); } catch(e) { alert(e.message); } }
async function showPipelineActivity(applicationId) { try { const data = await request(`/recruiter/pipeline/${applicationId}/activity`); const rows = data.activity || []; alert(rows.length ? rows.map(r => `${r.old_status} → ${r.new_status} | ${new Date(r.changed_at).toLocaleString()}`).join("\n") : "No status history yet."); } catch(e) { alert(e.message); } }

// ----------------------------------
// PAGE NAVIGATION
// ----------------------------------

function hideAllPages() {
    const pages = [
        "homePage",
        "jobsPage",
        "loginPage",
        "registerPage",
        "jobDetailsPage",
        "seekerDashboard",
        "recruiterDashboard",
        "postJobPage",
        "profilePage",
        "savedJobsPage",
        "notificationsPage",
        "adminPage",
        "recruiterPipelinePage",
        "candidateSearchPage",
        "recruiterShortlistPage",
        "interviewsPage",
        "smartJobsPage",
        "smartCandidatesPage",
        "careerIntelligencePage"
    ];

    pages.forEach(function (page) {
        document.getElementById(page).classList.add("hidden");
    });
}

function showHome() {
    hideAllPages();

    document.getElementById("homePage").classList.remove("hidden");
}

function showJobs() {
    hideAllPages();

    document.getElementById("jobsPage").classList.remove("hidden");

    loadJobs();
}

function showLogin() {
    hideAllPages();

    document.getElementById("loginPage").classList.remove("hidden");
}

function showRegister() {
    hideAllPages();

    document.getElementById("registerPage").classList.remove("hidden");
}

function showDashboard() {
    const user = getUser();

    if (!user) {
        showLogin();
        return;
    }

    if (user.role === "admin") {
        showAdminPanel();
    } else if (user.role === "seeker") {
        loadSeekerDashboard();
    } else {
        loadRecruiterDashboard();
    }
}

function showPostJob() {
    hideAllPages();

    document.getElementById("postJobPage").classList.remove("hidden");
}
// ======================================
// SHOW PROFILE PAGE
// ======================================

function showProfile() {
    const user = getUser();

    if (!user) {
        showLogin();
        return;
    }

    hideAllPages();

    document.getElementById("profilePage")
        .classList.remove("hidden");

    loadProfile();
}
// ======================================
// SAVED JOBS PAGE
// ======================================

function showSavedJobs() {
    const user = getUser();

    if (!user) {
        alert("Please login to view saved jobs.");
        showLogin();
        return;
    }

    if (user.role !== "seeker") {
        alert("Saved Jobs is available for job seekers only.");
        return;
    }

    hideAllPages();

    const page = document.getElementById("savedJobsPage");

    if (page) {
        page.classList.remove("hidden");
    }

    loadSavedJobs();
}

//logout
function logout(){
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    updateNavbar();
    showHome();
    alert("Logged out successfully!");
}


// ======================================
// NAVBAR
// ======================================

function updateNavbar() {
    const user = getUser();
    const navUser = document.getElementById("navUser");
    const adminLink = document.getElementById("adminNavLink");
    const smartJobsLink = document.getElementById("smartJobsNav");
    if (smartJobsLink) smartJobsLink.classList.toggle("hidden", !user || user.role !== "seeker");
    const smartCandidatesLink = document.getElementById("smartCandidatesNav");
    const careerIntelligenceLink = document.getElementById("careerIntelligenceNav");
    if (careerIntelligenceLink) careerIntelligenceLink.classList.toggle("hidden", !user || user.role !== "seeker");
    if (smartCandidatesLink) smartCandidatesLink.classList.toggle("hidden", !user || user.role !== "recruiter");
    const pipelineLink = document.getElementById("pipelineNav");
    if (pipelineLink) pipelineLink.classList.toggle("hidden", !user || user.role !== "recruiter");
    if (adminLink) adminLink.classList.toggle("hidden", !user || user.role !== "admin");
    if (!user) {
        navUser.innerHTML = `<button onclick="showLogin()">Login</button><button onclick="showRegister()">Register</button>`;
        return;
    }
    navUser.innerHTML = `
        <span>${escapeHTML(user.full_name || "")}</span>
        <button class="notification-nav-btn" onclick="showNotifications()">🔔 <span id="notificationCount" class="notification-count">0</span></button>
        <button onclick="showProfile()">My Profile</button>
        <button onclick="logout()">Logout</button>
    `;
    refreshNotificationCount();
}

// ----------------------------------
// REGISTER
// ----------------------------------

document.getElementById("registerForm")
.addEventListener("submit", async function (event) {

    event.preventDefault();

    const data = {
        full_name: document.getElementById("registerName").value,
        email: document.getElementById("registerEmail").value,
        phone: document.getElementById("registerPhone").value,
        password: document.getElementById("registerPassword").value,
        role: document.getElementById("registerRole").value
    };

    try {
        const result = await request("/auth/register", {
            method: "POST",
            body: JSON.stringify(data)
        });

        alert(result.message);

        document.getElementById("registerForm").reset();

        showLogin();

    } catch (error) {
        alert(error.message);
    }
});

// ----------------------------------
// LOGIN
// ----------------------------------

document.getElementById("loginForm")
.addEventListener("submit", async function (event) {

    event.preventDefault();

    const data = {
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value
    };

    try {
        const result = await request("/auth/login", {
            method: "POST",
            body: JSON.stringify(data)
        });

        localStorage.setItem("token", result.token);

        localStorage.setItem(
            "user",
            JSON.stringify(result.user)
        );

        document.getElementById("loginForm").reset();

        updateNavbar();

        alert("Login successful");

        showDashboard();

    } catch (error) {
        alert(error.message);
    }
});

// ----------------------------------
// JOB SEARCH
// ----------------------------------

function searchHomeJobs() {
    document.getElementById("jobSearch").value =
        document.getElementById("homeSearch").value;

    document.getElementById("jobLocation").value =
        document.getElementById("homeLocation").value;

    showJobs();
}

let jobSearchResults = [];
let currentJobsPage = 1;
const JOBS_PER_PAGE = 10;


function resetJobFilters() {
    document.getElementById("jobSearch").value = "";
    document.getElementById("jobLocation").value = "";
    document.getElementById("jobTypeFilter").value = "";
    document.getElementById("jobSort").value = "newest";
    currentJobsPage = 1;
    loadJobs();
}


function changeJobsPage(page) {
    currentJobsPage = page;
    renderJobsPage();
}


function renderJobsPage() {
    const jobsList = document.getElementById("jobsList");
    const pagination = document.getElementById("jobsPagination");
    const info = document.getElementById("jobResultsInfo");
    const sortMode = document.getElementById("jobSort").value;

    let sortedJobs = jobSearchResults.slice();
    if (sortMode === "title") {
        sortedJobs.sort((a, b) => String(a.job_title || "").localeCompare(String(b.job_title || "")));
    } else if (sortMode === "company") {
        sortedJobs.sort((a, b) => String(a.company_name || "").localeCompare(String(b.company_name || "")));
    }

    const total = sortedJobs.length;
    const totalPages = Math.max(1, Math.ceil(total / JOBS_PER_PAGE));
    currentJobsPage = Math.min(Math.max(1, currentJobsPage), totalPages);
    const startIndex = (currentJobsPage - 1) * JOBS_PER_PAGE;
    const pageJobs = sortedJobs.slice(startIndex, startIndex + JOBS_PER_PAGE);

    info.textContent = total ? `Showing ${startIndex + 1}-${Math.min(startIndex + pageJobs.length, total)} of ${total} jobs` : "No matching jobs found.";

    if (!total) {
        jobsList.innerHTML = "<p>No jobs found. Try changing your search or filters.</p>";
        pagination.innerHTML = "";
        return;
    }

    jobsList.innerHTML = pageJobs.map(function (job) {
        return `
            <div class="job-card">
                <h2>${escapeHTML(job.job_title)}</h2>
                <h3>${escapeHTML(job.company_name)}</h3>
                <p>Location: ${escapeHTML(job.location)}</p>
                <p>Type: ${escapeHTML(job.job_type)}</p>
                <p>Salary: ${escapeHTML(job.salary || "Not specified")}</p>
                <p>Skills: ${escapeHTML(job.skills || "Not specified")}</p>
                <button onclick="viewJob(${Number(job.id)})">View Details</button>
                <button onclick="toggleSavedJob(${Number(job.id)}, this)">${savedJobIds.has(Number(job.id)) ? "Saved ✓" : "Save Job"}</button>
            </div>
        `;
    }).join("");


    let pageButtons = "";
    if (totalPages > 1) {
        pageButtons += `<button ${currentJobsPage === 1 ? "disabled" : ""} onclick="changeJobsPage(${currentJobsPage - 1})">Previous</button>`;
        const low = Math.max(1, currentJobsPage - 2);
        const high = Math.min(totalPages, currentJobsPage + 2);
        for (let p = low; p <= high; p++) {
            pageButtons += `<button class="${p === currentJobsPage ? "active-page" : ""}" onclick="changeJobsPage(${p})">${p}</button>`;
        }
        pageButtons += `<button ${currentJobsPage === totalPages ? "disabled" : ""} onclick="changeJobsPage(${currentJobsPage + 1})">Next</button>`;
    }
    pagination.innerHTML = pageButtons;
}


async function loadJobs() {
    const search = document.getElementById("jobSearch").value.trim();
    const location = document.getElementById("jobLocation").value.trim();
    const jobType = document.getElementById("jobTypeFilter").value;
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    if (location) params.append("location", location);
    if (jobType) params.append("job_type", jobType);
    const url = "/jobs" + (params.toString() ? "?" + params.toString() : "");

    const jobsList = document.getElementById("jobsList");
    jobsList.innerHTML = "<p>Loading jobs...</p>";
    document.getElementById("jobsPagination").innerHTML = "";
    document.getElementById("jobResultsInfo").textContent = "";

    try {
        const jobs = await request(url);
        savedJobIds = new Set();
        const currentUser = getUser();
        if (currentUser && currentUser.role === "seeker" && getToken()) {
            try {
                const savedResult = await request("/saved-jobs");
                if (Array.isArray(savedResult.savedJobs)) {
                    savedJobIds = new Set(savedResult.savedJobs.map(item => Number(item.job_id)));
                }
            } catch (savedError) {
                console.error("Unable to load saved job IDs:", savedError);
            }
        }
        jobSearchResults = Array.isArray(jobs) ? jobs : [];
        currentJobsPage = 1;
        renderJobsPage();
    } catch (error) {
        jobsList.innerHTML = "<p>" + escapeHTML(error.message) + "</p>";
        document.getElementById("jobsPagination").innerHTML = "";
    }
}


// ----------------------------------
// JOB DETAILS
// ----------------------------------

async function viewJob(id) {
    currentJobId = id;

    hideAllPages();

    document.getElementById("jobDetailsPage")
        .classList.remove("hidden");

    const container = document.getElementById("jobDetails");

    container.innerHTML = "<p>Loading job...</p>";

    try {
        const job = await request("/jobs/" + id);

        container.innerHTML = `
            <div class="job-card">

                <h1>${escapeHTML(job.job_title)}</h1>

                <h2>${escapeHTML(job.company_name)}</h2>

                <p>
                    Location: ${escapeHTML(job.location)}
                </p>

                <p>
                    Job Type: ${escapeHTML(job.job_type)}
                </p>

                <p>
                    Salary: ${escapeHTML(job.salary || "Not specified")}
                </p>

                <p>
                    Skills: ${escapeHTML(job.skills || "Not specified")}
                </p>

                <h3>Description</h3>

                <p>
                    ${escapeHTML(job.description)}
                </p>

                <button onclick="applyForJob(${job.id})">
                    Apply for Job
                </button>

                <button class="secondary-btn"
                        onclick="showJobs()">
                    Back to Jobs
                </button>

            </div>
        `;

    } catch (error) {
        container.innerHTML = escapeHTML(error.message);
    }
}

// ----------------------------------
// APPLY FOR JOB
// ----------------------------------

async function applyForJob(jobId) {
    const token = localStorage.getItem("token");
    if (!token) {
        alert("Please login before applying.");
        showLogin();
        return;
    }
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (user.role !== "seeker") {
        alert("Only job seekers can apply for jobs.");
        return;
    }
    const coverLetter = prompt("Enter your cover letter (optional):") || "";
    try {
        const response = await fetch("http://localhost:5000/api/applications", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                job_id: jobId,
                cover_letter: coverLetter
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Application failed");
        }
        alert("Application submitted successfully!");
        refreshNotificationCount();
    } catch (error) {
        alert(error.message);
    }
}

// ----------------------------------
// SEEKER DASHBOARD
// ----------------------------------

async function loadSeekerDashboard() {
    hideAllPages();

    document.getElementById("seekerDashboard")
        .classList.remove("hidden");

    const container = document.getElementById("myApplications");

    container.innerHTML = "<p>Loading applications...</p>";

    try {
        const result = await request("/applications/my");

        // Extract the actual array from the API response
        let applications = [];

        if (Array.isArray(result)) {
            applications = result;
        } else if (Array.isArray(result.applications)) {
            applications = result.applications;
        } else if (Array.isArray(result.data)) {
            applications = result.data;
        } else if (Array.isArray(result.results)) {
            applications = result.results;
        } else {
            console.error("Unexpected applications API response:", result);
            container.innerHTML = "<p>Invalid applications response from server.</p>";
            return;
        }

        if (applications.length === 0) {
            container.innerHTML = "<p>You haven't applied for any jobs.</p>";
            return;
        }

        container.innerHTML = applications.map(function (application) {
            return `
                <div class="application-card">

                    <h3>${escapeHTML(application.job_title || "Job Title")}</h3>

                    <p>
                        Company:
                        ${escapeHTML(application.company_name || "Not specified")}
                    </p>

                    <p>
                        Location:
                        ${escapeHTML(application.location || "Not specified")}
                    </p>

                    <p>
                        Applied on:
                        ${
                            application.applied_at
                                ? new Date(application.applied_at).toLocaleDateString()
                                : "Not available"
                        }
                    </p>

                    <p>
                        Status:
                        <span class="status">
                            ${escapeHTML(application.status || "Applied")}
                        </span>
                    </p>

                </div>
            `;
        }).join("");

    } catch (error) {
        console.error("Seeker dashboard error:", error);
        container.innerHTML = "<p>" + escapeHTML(error.message) + "</p>";
    }

    await loadSeekerInterviews();
}

// Phase 10: seeker-side interview visibility. Recruiter notes are intentionally not exposed.
async function loadSeekerInterviews() {
    const container = document.getElementById("seekerInterviews");
    if (!container) return;
    const user = getUser();
    if (!user || user.role !== "seeker") {
        container.innerHTML = "<p>Log in as a job seeker to view interviews.</p>";
        return;
    }
    container.innerHTML = "<p>Loading interviews...</p>";
    try {
        const data = await request("/seeker/interviews");
        const rows = Array.isArray(data.interviews) ? data.interviews : [];
        if (!rows.length) { container.innerHTML = "<p>No interviews scheduled for your applications yet.</p>"; return; }
        container.innerHTML = rows.map(interview => {
            const date = new Date(interview.scheduled_at);
            const dateText = Number.isNaN(date.getTime()) ? escapeHTML(interview.scheduled_at || "Not provided") : escapeHTML(date.toLocaleString());
            const link = safeMeetingLink(interview.meeting_link);
            return `<article class="seeker-interview-card">
                <div class="seeker-interview-top"><div><h3>${escapeHTML(interview.job_title || "Interview")}</h3><p>${escapeHTML(interview.company_name || "Company not provided")}</p></div><span class="interview-status">${escapeHTML(interview.status || "Scheduled")}</span></div>
                <p><strong>Date &amp; time:</strong> ${dateText}</p><p><strong>Type:</strong> ${escapeHTML(interview.interview_type || "Not provided")}</p>
                ${link ? `<p><strong>Meeting:</strong> <a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">Join / Open meeting</a></p>` : ""}
                ${interview.status === "Cancelled" ? `<p class="interview-cancelled-note">This interview was cancelled.</p>` : ""}
            </article>`;
        }).join("");
    } catch (error) { container.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`; }
}
function safeMeetingLink(value) {
    if (!value) return "";
    try { const url = new URL(String(value)); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; }
    catch (_) { return ""; }
}

// ----------------------------------
// POST JOB
// ----------------------------------

document.getElementById("postJobForm")
.addEventListener("submit", async function (event) {

    event.preventDefault();

    const data = {
        company_name: document.getElementById("companyName").value,
        job_title: document.getElementById("jobTitle").value,
        location: document.getElementById("jobPostLocation").value,
        job_type: document.getElementById("jobType").value,
        salary: document.getElementById("salary").value,
        skills: document.getElementById("skills").value,
        description: document.getElementById("jobDescription").value
    };

    try {
        const result = await request("/jobs", {
            method: "POST",
            body: JSON.stringify(data)
        });

        alert(result.message);

        document.getElementById("postJobForm").reset();

        loadRecruiterDashboard();

    } catch (error) {
        alert(error.message);
    }
});

// ----------------------------------
// RECRUITER DASHBOARD
// ----------------------------------

async function loadRecruiterDashboard() {
    hideAllPages();
    const analyticsPanel = document.getElementById("recruiterAnalytics");
    if (analyticsPanel) analyticsPanel.classList.add("hidden");
    document.getElementById("recruiterJobs").classList.remove("hidden");

    document.getElementById("recruiterDashboard")
        .classList.remove("hidden");

    const container = document.getElementById("recruiterJobs");

    container.innerHTML = "<p>Loading jobs...</p>";

    try {
        const result = await request("/applications/recruiter/jobs");

        // Backend returns { success: true, jobs: [...] }
        const jobs = Array.isArray(result.jobs) ? result.jobs : [];

        if (jobs.length === 0) {
            container.innerHTML = "<p>You haven't posted any jobs.</p>";
            return;
        }

        container.innerHTML = jobs.map(function (job) {
            return `
                <div class="recruiter-job-card">

                    <h2>${escapeHTML(job.job_title)}</h2>

                    <p>${escapeHTML(job.company_name)}</p>

                    <p>
                        Location: ${escapeHTML(job.location || "Not specified")}
                    </p>

                    <button onclick="viewApplicants(${job.id})">
                        View Applicants
                    </button>

                    <button onclick="deleteJob(${job.id})">
                        Delete Job
                    </button>

                </div>
            `;
        }).join("");

    } catch (error) {
        console.error("Recruiter dashboard error:", error);
        container.innerHTML = "<p>" + escapeHTML(error.message) + "</p>";
    }
}


// ======================================
// PHASE 5 - RECRUITER ANALYTICS UI
// ======================================
async function loadRecruiterAnalytics() {
    const user = getUser();
    if (!user || user.role !== "recruiter") { alert("Recruiter access only."); return; }
    hideAllPages();
    document.getElementById("recruiterDashboard").classList.remove("hidden");
    const panel = document.getElementById("recruiterAnalytics");
    panel.classList.remove("hidden");
    document.getElementById("recruiterJobs").classList.add("hidden");
    const statsEl = document.getElementById("recruiterAnalyticsStats");
    const jobsEl = document.getElementById("analyticsJobs");
    const statusEl = document.getElementById("analyticsStatuses");
    const monthlyEl = document.getElementById("analyticsMonthly");
    statsEl.innerHTML = jobsEl.innerHTML = statusEl.innerHTML = monthlyEl.innerHTML = "<p>Loading...</p>";
    try {
        const data = await request("/recruiter/analytics");
        const s = data.summary || {};
        const num = (v) => Number(v || 0);
        statsEl.innerHTML = `
          <div class="analytics-stat"><span>Total Jobs</span><strong>${num(s.total_jobs)}</strong></div>
          <div class="analytics-stat"><span>Applications</span><strong>${num(s.total_applications)}</strong></div>
          <div class="analytics-stat"><span>Shortlisted</span><strong>${num(s.shortlisted)}</strong></div>
          <div class="analytics-stat"><span>Selected</span><strong>${num(s.selected)}</strong></div>`;
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        jobsEl.innerHTML = jobs.length ? jobs.map(j => {
            const count = Number(j.applications || 0);
            const max = Math.max(1, ...jobs.map(x => Number(x.applications || 0)));
            const pct = Math.round(count/max*100);
            return `<div class="analytics-bar-row"><div class="analytics-bar-label"><strong>${escapeHTML(j.job_title || "Untitled job")}</strong><span>${count} applicant(s) · ${Number(j.shortlisted||0)} shortlisted · ${Number(j.selected||0)} selected</span></div><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${pct}%"></div></div></div>`;
        }).join("") : "<p>No job postings yet.</p>";
        const statuses = [
            ["Applied", num(s.applied)], ["Shortlisted", num(s.shortlisted)],
            ["Selected", num(s.selected)], ["Rejected", num(s.rejected)]
        ];
        const total = Math.max(1, num(s.total_applications));
        statusEl.innerHTML = statuses.map(([label,count]) => `<div class="analytics-bar-row"><div class="analytics-bar-label"><strong>${label}</strong><span>${count} (${Math.round(count/total*100)}%)</span></div><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.round(count/total*100)}%"></div></div></div>`).join("");
        const months = Array.isArray(data.monthly) ? data.monthly : [];
        monthlyEl.innerHTML = months.length ? months.map(m => `<div class="analytics-month"><strong>${escapeHTML(m.month || "")}</strong><span>${Number(m.applications||0)} application(s)</span></div>`).join("") : "<p>No monthly application data yet.</p>";
    } catch (error) {
        statsEl.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`;
        jobsEl.innerHTML = statusEl.innerHTML = monthlyEl.innerHTML = "";
    }
}


// ----------------------------------
// VIEW APPLICANTS
// ----------------------------------

async function viewApplicants(jobId) {
    hideAllPages();
    const analyticsPanel = document.getElementById("recruiterAnalytics");
    if (analyticsPanel) analyticsPanel.classList.add("hidden");
    document.getElementById("recruiterJobs").classList.remove("hidden");

    document.getElementById("recruiterDashboard")
        .classList.remove("hidden");

    const container = document.getElementById("recruiterJobs");

    container.innerHTML = "<p>Loading applicants...</p>";

    try {
        const result = await request(
            "/applications/recruiter/jobs/" + jobId + "/applications"
        );

        // Backend returns { success: true, applicants: [...] }
        const applicants = Array.isArray(result.applicants)
            ? result.applicants
            : [];

        if (applicants.length === 0) {
            container.innerHTML = `
                <button onclick="loadRecruiterDashboard()">Back to Jobs</button>
                <p>No applicants yet.</p>
            `;
            return;
        }

        container.innerHTML = `
            <button onclick="loadRecruiterDashboard()">
                Back to Jobs
            </button>
        ` + applicants.map(function (application) {
            return `
                <div class="application-card">

                    <h2>${escapeHTML(application.full_name)}</h2>

                    <p>Email: ${escapeHTML(application.email)}</p>

                    <p>
                        Phone: ${escapeHTML(application.phone || "Not provided")}
                    </p>

                    <p>
                        Cover Letter:
                        ${escapeHTML(application.cover_letter || "Not provided")}
                    </p>

                    ${application.resume_path ? `
                        <p><button type="button" class="secondary-btn" onclick="downloadApplicantResume(${application.application_id})">View / Download Resume</button></p>
                    ` : "<p>Resume not uploaded by this applicant.</p>"}

                    <p>
                        Current Status:
                        ${escapeHTML(application.status || "Applied")}
                    </p>

                    <label for="status-${application.application_id}">
                        Update Status:
                    </label>

                    <select id="status-${application.application_id}">
                        <option>Applied</option>
                        <option>Shortlisted</option>
                        <option>Rejected</option>
                        <option>Selected</option>
                    </select>

                    <button onclick="updateStatus(
                        ${application.application_id},
                        ${jobId}
                    )">
                        Update Status
                    </button>

                </div>
            `;
        }).join("");

        // Set each dropdown to the current application status
        applicants.forEach(function (application) {
            const select = document.getElementById(
                "status-" + application.application_id
            );

            if (select) {
                select.value = application.status || "Applied";
            }
        });

    } catch (error) {
        console.error("View applicants error:", error);
        container.innerHTML = "<p>" + escapeHTML(error.message) + "</p>";
    }
}



// ----------------------------------
// UPDATE APPLICATION STATUS
// ----------------------------------

async function downloadApplicantResume(applicationId) {
    try {
        const response = await fetch(
            "http://localhost:5000/api/applications/recruiter/" + applicationId + "/resume",
            { headers: { Authorization: "Bearer " + getToken() } }
        );
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.message || "Resume download failed");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "applicant-resume";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert(error.message);
    }
}

async function updateStatus(applicationId, jobId) {
    const select = document.getElementById(
        "status-" + applicationId
    );

    const status = select.value;

    try {
        const result = await request(
            "/applications/" + applicationId + "/status",
            {
                method: "PUT",
                body: JSON.stringify({ status })
            }
        );

        alert(result.message);
        refreshNotificationCount();

        viewApplicants(jobId);

    } catch (error) {
        alert(error.message);
    }
}

// ----------------------------------
// DELETE JOB
// ----------------------------------

async function deleteJob(jobId) {
    const confirmDelete = confirm(
        "Are you sure you want to delete this job?"
    );

    if (!confirmDelete) {
        return;
    }

    try {
        const result = await request("/jobs/" + jobId, {
            method: "DELETE"
        });

        alert(result.message);

        loadRecruiterDashboard();

    } catch (error) {
        alert(error.message);
    }
}
// ======================================
// MY APPLICATIONS - JOB SEEKER DASHBOARD
// ======================================

async function loadMyApplications() {
    const container = document.getElementById("applicationsContainer");

    if (!container) return;

    const token = localStorage.getItem("token");

    if (!token) {
        container.innerHTML = "<p>Please login first.</p>";
        return;
    }

    container.innerHTML = "<p>Loading applications...</p>";

    try {
        const response = await fetch(
            "http://localhost:5000/api/applications/my",
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Failed to fetch applications");
        }

        // Extract array safely from the API response
        const applications = Array.isArray(result)
            ? result
            : Array.isArray(result.applications)
                ? result.applications
                : Array.isArray(result.data)
                    ? result.data
                    : [];

        renderMyApplications(applications);

    } catch (error) {
        console.error("My Applications Error:", error);
        container.innerHTML = `<p>${error.message}</p>`;
    }
}


// ======================================
// RENDER APPLICATIONS
// ======================================

function renderMyApplications(applications) {
    const container = document.getElementById("applicationsContainer");
    if (!container) return;
    if (!Array.isArray(applications)) applications = [];
    if (!applications.length) {
        container.innerHTML = `<div class="application-card"><h3>No applications yet</h3><p>Apply for jobs to see them here.</p></div>`;
        return;
    }
    container.innerHTML = applications.map(app => `
        <div class="application-card">
            <h3>${escapeHTML(app.job_title || app.title || "Job Title")}</h3>
            <p><strong>Company:</strong> ${escapeHTML(app.company_name || "N/A")}</p>
            <p><strong>Location:</strong> ${escapeHTML(app.location || "N/A")}</p>
            <p><strong>Status:</strong> <span class="application-status-pill">${escapeHTML(app.status || "Applied")}</span></p>
            <p><strong>Applied on:</strong> ${app.applied_at ? escapeHTML(new Date(app.applied_at).toLocaleDateString()) : "N/A"}</p>
        </div>
    `).join("");
}


// ======================================
// PAGE LOAD
// ======================================

if (document.getElementById("applicationsContainer")) {
    loadMyApplications();
}

// ======================================
// USER PROFILE MANAGEMENT
// ======================================

async function loadProfile() {
    const message = document.getElementById("resumeMessage");

    try {
        const result = await request("/profile");

        if (!result.profile) {
            throw new Error("Profile data not received");
        }

        const profile = result.profile;

        document.getElementById("profileFullName").value =
            profile.full_name || "";

        document.getElementById("profileEmail").value =
            profile.email || "";

        document.getElementById("profilePhone").value =
            profile.phone || "";

        document.getElementById("profileEducation").value =
            profile.education || "";

        document.getElementById("profileGraduationYear").value =
            profile.graduation_year || "";

        document.getElementById("profileSkills").value =
            profile.skills || "";

        document.getElementById("profileSummary").value =
            profile.professional_summary || "";

        document.getElementById("profileExperience").value =
            profile.experience || "";

        updateProfileProgress();

        displayResume(profile.resume_path);

    } catch (error) {
        console.error("Load profile error:", error);

        if (message) {
            message.textContent = error.message;
        }
    }
}


// ======================================
// PROFILE COMPLETION
// ======================================

function updateProfileProgress() {
    const fields = [
        document.getElementById("profileFullName").value.trim(),
        document.getElementById("profilePhone").value.trim(),
        document.getElementById("profileEducation").value.trim(),
        document.getElementById("profileGraduationYear").value.trim(),
        document.getElementById("profileSkills").value.trim(),
        document.getElementById("profileSummary").value.trim(),
        document.getElementById("profileExperience").value.trim()
    ];

    const completed = fields.filter(function (field) {
        return field !== "";
    }).length;

    const percentage = Math.round(
        (completed / fields.length) * 100
    );

    document.getElementById("profileProgressBar")
        .style.width = percentage + "%";

    document.getElementById("profileProgressText")
        .textContent = percentage + "% Complete";
}


// Update progress while typing
[
    "profileFullName",
    "profilePhone",
    "profileEducation",
    "profileGraduationYear",
    "profileSkills",
    "profileSummary",
    "profileExperience"
].forEach(function (id) {
    const element = document.getElementById(id);

    if (element) {
        element.addEventListener("input", updateProfileProgress);
    }
});


// ======================================
// SAVE PROFILE
// ======================================

document.getElementById("profileForm")
    .addEventListener("submit", async function (event) {

        event.preventDefault();

        const button = document.getElementById("saveProfileBtn");

        button.disabled = true;
        button.textContent = "Saving...";

        const data = {
            full_name: document.getElementById("profileFullName").value.trim(),
            phone: document.getElementById("profilePhone").value.trim(),
            education: document.getElementById("profileEducation").value.trim(),
            graduation_year: document.getElementById("profileGraduationYear").value.trim(),
            skills: document.getElementById("profileSkills").value.trim(),
            professional_summary: document.getElementById("profileSummary").value.trim(),
            experience: document.getElementById("profileExperience").value.trim()
        };

        try {
            const result = await request("/profile", {
                method: "PUT",
                body: JSON.stringify(data)
            });

            // Update saved user name in local storage
            const user = getUser();

            if (user) {
                user.full_name = data.full_name;

                localStorage.setItem(
                    "user",
                    JSON.stringify(user)
                );

                updateNavbar();
            }

            alert(result.message || "Profile updated successfully!");

            updateProfileProgress();

        } catch (error) {
            alert(error.message);

        } finally {
            button.disabled = false;
            button.textContent = "Save Profile";
        }
    });


// ======================================
// DISPLAY RESUME
// ======================================

function displayResume(resumePath) {
    const container = document.getElementById("resumeLinkContainer");

    if (!container) return;

    if (!resumePath) {
        container.innerHTML = "<p>No resume uploaded yet.</p>";
        return;
    }

    container.innerHTML = `
        <p>Uploaded Resume:</p>
        <button type="button" class="secondary-btn" onclick="downloadMyResume()">
            View / Download Resume
        </button>
    `;
}


// AUTHENTICATED RESUME DOWNLOAD FOR SEEKER
async function downloadMyResume() {
    try {
        const response = await fetch("http://localhost:5000/api/profile/resume", {
            headers: { Authorization: "Bearer " + getToken() }
        });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.message || "Resume download failed");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "resume";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert(error.message);
    }
}

// ======================================
// UPLOAD RESUME
// ======================================

document.getElementById("resumeForm")
    .addEventListener("submit", async function (event) {

        event.preventDefault();

        const fileInput = document.getElementById("resumeFile");
        const message = document.getElementById("resumeMessage");

        const file = fileInput.files[0];

        if (!file) {
            message.textContent = "Please select a resume.";
            return;
        }

        const allowedExtensions = ["pdf", "doc", "docx"];

        const extension = file.name
            .split(".")
            .pop()
            .toLowerCase();

        if (!allowedExtensions.includes(extension)) {
            message.textContent = "Only PDF, DOC and DOCX files are allowed.";
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            message.textContent = "Resume must be less than 5 MB.";
            return;
        }

        const formData = new FormData();

        formData.append("resume", file);

        message.textContent = "Uploading resume...";

        try {
            const response = await fetch(
                "http://localhost:5000/api/profile/resume",
                {
                    method: "POST",
                    headers: {
                        Authorization: "Bearer " + getToken()
                    },
                    body: formData
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Resume upload failed");
            }

            message.textContent = result.message || "Resume uploaded successfully!";

            displayResume(result.resume_path);

            fileInput.value = "";

        } catch (error) {
            console.error("Resume upload error:", error);

            message.textContent = error.message;
        }
    });

// ======================================
// PHASE 2 - SAVED JOBS
// ======================================

async function loadSavedJobs() {
    const container = document.getElementById("savedJobsList");

    if (!container) return;

    container.innerHTML = "<p>Loading saved jobs...</p>";

    try {
        const result = await request("/saved-jobs");

        const savedJobs = Array.isArray(result.savedJobs)
            ? result.savedJobs
            : [];

        savedJobIds = new Set(
            savedJobs.map(job => Number(job.job_id))
            );

        renderSavedJobs(savedJobs);

    } catch (error) {
        console.error("Load saved jobs error:", error);

        container.innerHTML =
            "<p>" + escapeHTML(error.message) + "</p>";
    }
}

// Normalizes the saved jobs list
function savededJobsFix(savedJobs) {
    return Array.isArray(savedJobs) ? savedJobs : [];
}

function renderSavedJobs(savedJobs) {
    const container = document.getElementById("savedJobsList");

    if (!container) return;

    if (!Array.isArray(savedJobs) || savedJobs.length === 0) {
        container.innerHTML = `
            <div class="empty-saved-jobs">
                <h3>No saved jobs yet</h3>
                <p>Browse jobs and bookmark opportunities you like.</p>
                <button onclick="showJobs()">Browse Jobs</button>
            </div>
        `;
        return;
    }

    container.innerHTML = savedJobs.map(function (job) {
        return `
            <div class="job-card saved-job-card">

                <h2>${escapeHTML(job.job_title)}</h2>

                <h3>${escapeHTML(job.company_name)}</h3>

                <p>Location: ${escapeHTML(job.location || "Not specified")}</p>

                <p>Type: ${escapeHTML(job.job_type || "Not specified")}</p>

                <p>Salary: ${escapeHTML(job.salary || "Not specified")}</p>

                <p>Skills: ${escapeHTML(job.skills || "Not specified")}</p>

                <button onclick="viewJob(${Number(job.job_id)})">
                    View Details
                </button>

                <button onclick="applyForJob(${Number(job.job_id)})">
                    Apply Now
                </button>

                <button class="secondary-btn"
                    onclick="removeSavedJob(${Number(job.job_id)})">
                    Remove Saved
                </button>

            </div>
        `;
    }).join("");
}


// SAVE OR UNSAVE A JOB
async function toggleSavedJob(jobId, button) {
    const user = getUser();

    if (!user || !getToken()) {
        alert("Please login as a job seeker to save jobs.");
        showLogin();
        return;
    }

    if (user.role !== "seeker") {
        alert("Only job seekers can save jobs.");
        return;
    }

    jobId = Number(jobId);

    try {
        if (savedJobIds.has(jobId)) {
            await request("/saved-jobs/" + jobId, {
                method: "DELETE"
            });

            savedJobIds.delete(jobId);

            if (button) {
                button.textContent = "Save Job";
            }

        } else {
            await request("/saved-jobs", {
                method: "POST",
                body: JSON.stringify({
                    job_id: jobId
                })
            });

            savedJobIds.add(jobId);

            if (button) {
                button.textContent = "Saved ✓";
            }
        }

    } catch (error) {
        alert(error.message);
    }
}


// REMOVE JOB FROM SAVED JOBS PAGE
async function removeSavedJob(jobId) {
    try {
        await request("/saved-jobs/" + jobId, {
            method: "DELETE"
        });

        savedJobIds.delete(Number(jobId));

        loadSavedJobs();

    } catch (error) {
        alert(error.message);
    }
}    

// ======================================
// PHASE 3 - NOTIFICATIONS UI
// ======================================

async function refreshNotificationCount() {
    const badge = document.getElementById("notificationCount");
    if (!badge || !getToken()) return;
    try {
        const result = await request("/notifications");
        const count = Number(result.unreadCount || 0);
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.classList.toggle("hidden", count === 0);
    } catch (error) {
        console.warn("Notification count refresh failed:", error.message);
    }
}


// ======================================
// PHASE 4 - ADMIN PANEL
// ======================================
function showAdminPanel() {
    const user = getUser();
    if (!user || user.role !== "admin") { alert("Admin access only."); return; }
    hideAllPages();
    document.getElementById("adminPage").classList.remove("hidden");
    loadAdminPanel();
}

async function loadAdminPanel() {
    const user = getUser();
    if (!user || user.role !== "admin") return;
    const statsEl = document.getElementById("adminStats");
    const usersEl = document.getElementById("adminUsers");
    const jobsEl = document.getElementById("adminJobs");
    statsEl.innerHTML = "<p>Loading statistics...</p>";
    usersEl.innerHTML = "<p>Loading users...</p>";
    jobsEl.innerHTML = "<p>Loading jobs...</p>";
    try {
        const [stats, users, jobs] = await Promise.all([request("/admin/stats"), request("/admin/users"), request("/admin/jobs")]);
        statsEl.innerHTML = `
            <div class="admin-stat-card"><h3>Total Users</h3><strong>${stats.users}</strong></div>
            <div class="admin-stat-card"><h3>Job Seekers</h3><strong>${stats.seekers}</strong></div>
            <div class="admin-stat-card"><h3>Recruiters</h3><strong>${stats.recruiters}</strong></div>
            <div class="admin-stat-card"><h3>Jobs</h3><strong>${stats.jobs}</strong></div>
            <div class="admin-stat-card"><h3>Applications</h3><strong>${stats.applications}</strong></div>`;
        if (!users.length) usersEl.innerHTML = "<p>No users found.</p>";
        else usersEl.innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Action</th></tr></thead><tbody>${users.map(u => `<tr><td>${u.id}</td><td>${escapeHTML(u.full_name)}</td><td>${escapeHTML(u.email)}</td><td>${escapeHTML(u.phone || "-")}</td><td>${escapeHTML(u.role)}</td><td>${u.role === "admin" || Number(u.id) === Number(user.id) ? "Protected" : `<button class="danger-btn" onclick="adminDeleteUser(${Number(u.id)})">Delete</button>`}</td></tr>`).join("")}</tbody></table></div>`;
        if (!jobs.length) jobsEl.innerHTML = "<p>No jobs found.</p>";
        else jobsEl.innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Title</th><th>Company</th><th>Recruiter</th><th>Location</th><th>Action</th></tr></thead><tbody>${jobs.map(j => `<tr><td>${j.id}</td><td>${escapeHTML(j.job_title)}</td><td>${escapeHTML(j.company_name)}</td><td>${escapeHTML(j.recruiter_name)}<br><small>${escapeHTML(j.recruiter_email)}</small></td><td>${escapeHTML(j.location)}</td><td><button class="danger-btn" onclick="adminDeleteJob(${Number(j.id)})">Remove</button></td></tr>`).join("")}</tbody></table></div>`;
    } catch (error) {
        statsEl.innerHTML = `<p class="error-message">${escapeHTML(error.message)}</p>`;
        usersEl.innerHTML = ""; jobsEl.innerHTML = "";
    }
}
async function adminDeleteUser(userId) {
    if (!confirm("Delete this user and their related jobs/applications? This cannot be undone.")) return;
    try { const result = await request(`/admin/users/${userId}`, { method: "DELETE" }); alert(result.message); await loadAdminPanel(); }
    catch (error) { alert(error.message); }
}
async function adminDeleteJob(jobId) {
    if (!confirm("Remove this job and its applications/saved records? This cannot be undone.")) return;
    try { const result = await request(`/admin/jobs/${jobId}`, { method: "DELETE" }); alert(result.message); await loadAdminPanel(); }
    catch (error) { alert(error.message); }
}

function showNotifications() {
    if (!getUser() || !getToken()) {
        alert("Please login to view notifications.");
        showLogin();
        return;
    }
    hideAllPages();
    const page = document.getElementById("notificationsPage");
    if (page) page.classList.remove("hidden");
    loadNotifications();
}

async function loadNotifications() {
    const container = document.getElementById("notificationsList");
    if (!container) return;
    container.innerHTML = "<p>Loading notifications...</p>";
    try {
        const result = await request("/notifications");
        const notifications = Array.isArray(result.notifications) ? result.notifications : [];
        if (!notifications.length) {
            container.innerHTML = `<div class="notification-empty"><h3>No notifications yet</h3><p>Updates will appear here when there is activity.</p></div>`;
            refreshNotificationCount();
            return;
        }
        container.innerHTML = notifications.map(function (item) {
            const readClass = item.is_read ? "read" : "unread";
            const dateText = item.created_at ? new Date(item.created_at).toLocaleString() : "";
            return `<article class="notification-card ${readClass}">
                <div class="notification-card-content"><span class="notification-status-dot"></span><div><h3>${escapeHTML(item.title || "Notification")}</h3><p>${escapeHTML(item.message || "")}</p><small>${escapeHTML(dateText)}</small></div></div>
                <div class="notification-actions">${item.is_read ? "" : `<button onclick="markNotificationRead(${Number(item.id)})">Mark Read</button>`}<button class="secondary-btn" onclick="deleteNotification(${Number(item.id)})">Delete</button></div>
            </article>`;
        }).join("");
        refreshNotificationCount();
    } catch (error) {
        container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
    }
}

async function markNotificationRead(id) {
    try {
        await request("/notifications/" + Number(id) + "/read", { method: "PATCH" });
        await loadNotifications();
    } catch (error) { alert(error.message); }
}

async function markAllNotificationsRead() {
    try {
        await request("/notifications/read-all", { method: "PUT" });
        await loadNotifications();
    } catch (error) { alert(error.message); }
}

async function deleteNotification(id) {
    try {
        await request("/notifications/" + Number(id), { method: "DELETE" });
        await loadNotifications();
    } catch (error) { alert(error.message); }
}

// ----------------------------------
// INITIALIZATION
// ----------------------------------

updateNavbar();

showHome();
// Refresh the unread notification badge while the user is logged in.
setInterval(() => { if (getToken()) refreshNotificationCount(); }, 30000);
