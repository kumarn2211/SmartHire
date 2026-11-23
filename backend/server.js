require("dotenv").config();

const express = require("express");
const db = require("./db");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { pool, testDatabase } = require("./db");

const app = express();

app.use(cors());
app.use(express.json());


const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// Create resume directory automatically
const resumeDirectory = path.join(__dirname, "uploads", "resumes");

fs.mkdirSync(resumeDirectory, { recursive: true });

// Resume upload configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, resumeDirectory);
    },

    filename: function (req, file, cb) {
        const uniqueName =
            Date.now() +
            "-" +
            Math.round(Math.random() * 1000000) +
            path.extname(file.originalname);

        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        const allowed = [
            ".pdf",
            ".doc",
            ".docx"
        ];

        const extension = path.extname(file.originalname).toLowerCase();

        if (allowed.includes(extension)) {
            cb(null, true);
        } else {
            cb(new Error("Only PDF, DOC and DOCX files are allowed"));
        }
    }
});

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Authentication token required"
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }
}

// Role middleware
function requireRole(role) {
    return function (req, res, next) {
        if (req.user.role !== role) {
            return res.status(403).json({
                message: "Access denied"
            });
        }

        next();
    };
}

// Home test
app.get("/", (req, res) => {
    res.json({
        message: "SmartHire API is running",
        status: "success"
    });
});

// Database test
app.get("/api/test-db", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT NOW() AS time");

        res.json({
            message: "MySQL connection successful",
            data: rows[0]
        });
    } catch (error) {
        res.status(500).json({
            message: "Database connection failed",
            error: error.message
        });
    }
});

// REGISTER
app.post("/api/auth/register", async (req, res) => {
    try {
        const {
            full_name,
            email,
            password,
            role,
            phone
        } = req.body;

        if (!full_name || !email || !password || !role) {
            return res.status(400).json({
                message: "All required fields must be provided"
            });
        }

        if (!["seeker", "recruiter"].includes(role)) {
            return res.status(400).json({
                message: "Invalid account role"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                message: "Password must be at least 6 characters"
            });
        }

        const [existing] = await pool.execute(
            "SELECT id FROM users WHERE email = ?",
            [email]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.execute(
            `INSERT INTO users
            (full_name, email, password, role, phone)
            VALUES (?, ?, ?, ?, ?)`,
            [
                full_name,
                email,
                hashedPassword,
                role,
                phone || null
            ]
        );

        res.status(201).json({
            message: "Registration successful",
            userId: result.insertId
        });

    } catch (error) {
        console.error("Register error:", error);

        res.status(500).json({
            message: "Registration failed"
        });
    }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const [users] = await pool.execute(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                role: user.role,
                full_name: user.full_name,
                email: user.email
            },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            message: "Login failed"
        });
    }
});

// CURRENT USER
app.get(
    "/api/auth/me",
    authenticateToken,
    (req, res) => {
        res.json({
            user: req.user
        });
    }
);

// GET ALL JOBS
app.get("/api/jobs", async (req, res) => {
    try {
        const { search, location, job_type } = req.query;

        let sql = `
            SELECT jobs.*, users.full_name AS recruiter_name
            FROM jobs
            JOIN users ON jobs.recruiter_id = users.id
            WHERE 1=1
        `;

        const params = [];

        if (search) {
            sql += `
                AND (
                    job_title LIKE ?
                    OR company_name LIKE ?
                    OR skills LIKE ?
                )
            `;

            const searchTerm = `%${search}%`;

            params.push(
                searchTerm,
                searchTerm,
                searchTerm
            );
        }

        if (location) {
            sql += " AND location LIKE ?";
            params.push(`%${location}%`);
        }

        if (job_type) {
            sql += " AND job_type = ?";
            params.push(job_type);
        }

        sql += " ORDER BY jobs.created_at DESC";

        const [jobs] = await pool.execute(sql, params);

        res.json(jobs);

    } catch (error) {
        console.error("Get jobs error:", error);

        res.status(500).json({
            message: "Unable to fetch jobs"
        });
    }
});

// GET SINGLE JOB
// PHASE 13: RULE-BASED SMART MATCHING (no external AI service)
function matchTokens(value) {
    return String(value || "").toLowerCase().split(/[,;|\n\r]+/).map(v => v.trim()).filter(v => v.length > 1);
}
function uniqueTokens(value) { return [...new Set(matchTokens(value))]; }
function experienceYears(value) {
    const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : 0;
}
function calculateMatch(profile, job) {
    const candidateSkills = uniqueTokens(profile.skills);
    const requiredSkills = uniqueTokens(job.skills);
    const matchedSkills = requiredSkills.filter(skill => candidateSkills.includes(skill));
    const missingSkills = requiredSkills.filter(skill => !candidateSkills.includes(skill));
    const skillScore = requiredSkills.length ? (matchedSkills.length / requiredSkills.length) * 70 : (candidateSkills.length ? 35 : 0);
    const candidateYears = experienceYears(profile.experience);
    const jobYears = experienceYears(job.experience_required || job.experience || job.experience_level);
    const experienceScore = jobYears > 0 ? Math.min(candidateYears / jobYears, 1) * 20 : (candidateYears > 0 ? 20 : 10);
    const educationMatch = profile.education && job.education_required && String(profile.education).toLowerCase().includes(String(job.education_required).toLowerCase()) ? 10 : (job.education_required ? 0 : 5);
    const score = Math.round(Math.max(0, Math.min(100, skillScore + experienceScore + educationMatch)));
    return { score, matched_skills: matchedSkills, missing_skills: missingSkills, candidate_experience_years: candidateYears, required_experience_years: jobYears };
}
app.get("/api/seeker/recommended-jobs", authenticateToken, async (req, res) => {
    if (req.user.role !== "seeker") return res.status(403).json({ message: "Only job seekers can view recommendations" });
    try {
        const [profiles] = await pool.query("SELECT skills, education, experience FROM user_profiles WHERE user_id = ?", [req.user.id]);
        const profile = profiles[0] || {};
        const [jobs] = await pool.query("SELECT * FROM jobs ORDER BY created_at DESC");
        const recommendations = jobs.map(job => ({ ...job, match: calculateMatch(profile, job) })).sort((a,b) => b.match.score - a.match.score);
        res.json({ success: true, recommendations });
    } catch (error) { console.error("Recommended jobs error:", error); res.status(500).json({ message: "Failed to calculate job recommendations" }); }
});
// PHASE 14: Career Intelligence (transparent rule-based analysis)
app.get("/api/seeker/career-intelligence", authenticateToken, async (req, res) => {
    if (req.user.role !== "seeker") return res.status(403).json({ message: "Only seekers can access career intelligence" });
    try {
        const [profiles] = await pool.query("SELECT skills, education, experience, professional_summary, graduation_year FROM user_profiles WHERE user_id = ?", [req.user.id]);
        const profile = profiles[0] || {};
        const [jobs] = await pool.query("SELECT * FROM jobs ORDER BY created_at DESC");
        const ranked = jobs.map(job => ({ ...job, match: calculateMatch(profile, job) })).sort((a, b) => b.match.score - a.match.score);
        const counts = {};
        ranked.slice(0, 20).forEach(job => (job.match.missing_skills || []).forEach(skill => {
            const key = String(skill).trim(); if (key) counts[key] = (counts[key] || 0) + 1;
        }));
        const gaps = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([skill, demand]) => ({ skill, demand }));
        const skills = uniqueTokens(profile.skills);
        const recommendations = ranked.slice(0, 8).map(job => ({ id: job.id, job_title: job.job_title, company_name: job.company_name, location: job.location, match: job.match }));
        const roadmap = gaps.slice(0, 6).map((item, index) => ({
            skill: item.skill, demand: item.demand,
            priority: index < 2 ? "High" : index < 4 ? "Medium" : "Low",
            suggested_action: `Study ${item.skill}, practice with a small project, and add it to your profile once you can demonstrate it.`
        }));
        res.json({ success: true, profile: { skills, education: profile.education || "", experience: profile.experience || "", summary: profile.professional_summary || "", graduation_year: profile.graduation_year || "" }, recommendations, skill_gaps: gaps, roadmap });
    } catch (error) {
        console.error("Career intelligence error:", error);
        res.status(500).json({ message: "Unable to calculate career intelligence" });
    }
});


app.get("/api/recruiter/smart-candidates", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Only recruiters can view smart candidates" });
    const jobId = Number(req.query.job_id);
    if (!Number.isInteger(jobId) || jobId < 1) return res.status(400).json({ message: "A valid job_id is required" });
    try {
        const [jobs] = await pool.query("SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?", [jobId, req.user.id]);
        if (!jobs.length) return res.status(404).json({ message: "Job not found or not owned by you" });
        const job = jobs[0];
        const [candidates] = await pool.query("SELECT u.id, u.full_name, p.professional_summary, p.education, p.graduation_year, p.skills, p.experience, CASE WHEN p.resume_path IS NOT NULL AND p.resume_path <> '' THEN 1 ELSE 0 END AS has_resume FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.role = 'seeker' ORDER BY u.full_name");
        const ranked = candidates.map(candidate => ({ ...candidate, match: calculateMatch(candidate, job) })).sort((a,b) => b.match.score - a.match.score);
        res.json({ success: true, job, candidates: ranked });
    } catch (error) { console.error("Smart candidates error:", error); res.status(500).json({ message: "Failed to rank candidates" }); }
});

app.get("/api/jobs/:id", async (req, res) => {
    try {
        const [jobs] = await pool.execute(
            `SELECT jobs.*, users.full_name AS recruiter_name
             FROM jobs
             JOIN users ON jobs.recruiter_id = users.id
             WHERE jobs.id = ?`,
            [req.params.id]
        );

        if (jobs.length === 0) {
            return res.status(404).json({
                message: "Job not found"
            });
        }

        res.json(jobs[0]);

    } catch (error) {
        res.status(500).json({
            message: "Unable to fetch job"
        });
    }
});

// CREATE JOB
app.post(
    "/api/jobs",
    authenticateToken,
    requireRole("recruiter"),
    async (req, res) => {
        try {
            const {
                company_name,
                job_title,
                location,
                job_type,
                salary,
                description,
                skills
            } = req.body;

            if (
                !company_name ||
                !job_title ||
                !location ||
                !job_type ||
                !description
            ) {
                return res.status(400).json({
                    message: "Required job fields are missing"
                });
            }

            const [result] = await pool.execute(
                `INSERT INTO jobs
                (
                    recruiter_id,
                    company_name,
                    job_title,
                    location,
                    job_type,
                    salary,
                    description,
                    skills
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    company_name,
                    job_title,
                    location,
                    job_type,
                    salary || null,
                    description,
                    skills || null
                ]
            );

            res.status(201).json({
                message: "Job created successfully",
                jobId: result.insertId
            });

        } catch (error) {
            console.error("Create job error:", error);

            res.status(500).json({
                message: "Job creation failed"
            });
        }
    }
);

// DELETE JOB
app.delete(
    "/api/jobs/:id",
    authenticateToken,
    requireRole("recruiter"),
    async (req, res) => {
        try {
            const [result] = await pool.execute(
                `DELETE FROM jobs
                 WHERE id = ? AND recruiter_id = ?`,
                [
                    req.params.id,
                    req.user.id
                ]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Job not found or not owned by you"
                });
            }

            res.json({
                message: "Job deleted successfully"
            });

        } catch (error) {
            res.status(500).json({
                message: "Job deletion failed"
            });
        }
    }
);

// ======================================
// SMART HIRE APPLICATION SYSTEM
// MYSQL2/PROMISE VERSION
// ======================================

// 1. JOB SEEKER APPLY FOR JOB
app.post("/api/applications", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "seeker") {
            return res.status(403).json({
                message: "Only job seekers can apply"
            });
        }

        const { job_id, cover_letter } = req.body;
        const applicant_id = req.user.id;

        if (!job_id) {
            return res.status(400).json({
                message: "Job ID is required"
            });
        }

        const [jobs] = await pool.query(
            "SELECT id, recruiter_id, job_title FROM jobs WHERE id = ?",
            [job_id]
        );

        if (jobs.length === 0) {
            return res.status(404).json({
                message: "Job not found"
            });
        }

        const [existing] = await pool.query(
            "SELECT id FROM applications WHERE job_id = ? AND applicant_id = ?",
            [job_id, applicant_id]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                message: "You have already applied for this job"
            });
        }

        const [result] = await pool.query(
            `INSERT INTO applications
            (job_id, applicant_id, cover_letter, status)
            VALUES (?, ?, ?, 'Applied')`,
            [job_id, applicant_id, cover_letter || ""]
        );

        // Notify the recruiter about the new application (notification failure does not undo application).
        try {
            await pool.query(
                `INSERT INTO notifications (user_id, title, message, type, related_job_id, related_application_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [jobs[0].recruiter_id, "New Job Application", `${req.user.full_name || "A job seeker"} applied for ${jobs[0].job_title}.`, "application", job_id, result.insertId]
            );
        } catch (notificationError) {
            console.error("Application notification insert error:", notificationError);
        }


        res.status(201).json({
            success: true,
            message: "Application submitted successfully",
            applicationId: result.insertId
        });

    } catch (error) {
        console.error("Apply error:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "You have already applied for this job"
            });
        }

        res.status(500).json({
            message: "Failed to submit application"
        });
    }
});


// 2. JOB SEEKER - MY APPLICATIONS
app.get("/api/applications/my", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "seeker") {
            return res.status(403).json({
                message: "Only job seekers can view applications"
            });
        }

        const applicant_id = req.user.id;

        const [applications] = await pool.query(
            `SELECT
                a.id AS application_id,
                a.job_id,
                a.applicant_id,
                a.cover_letter,
                a.status,
                a.applied_at,
                j.job_title,
                j.company_name,
                j.location,
                j.job_type,
                j.salary
            FROM applications a
            JOIN jobs j ON a.job_id = j.id
            WHERE a.applicant_id = ?
            ORDER BY a.applied_at DESC`,
            [applicant_id]
        );

        res.json({
            success: true,
            applications
        });

    } catch (error) {
        console.error("My applications error:", error);

        res.status(500).json({
            message: "Failed to load applications"
        });
    }
});


// 3. RECRUITER - MY JOBS
// ======================================
// PHASE 5 - RECRUITER ANALYTICS API
// ======================================
// ======================================
// PHASE 12: RECRUITMENT PIPELINE
// ======================================
app.get("/api/recruiter/pipeline", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access only" });
    try {
        const { search = "", job = "", status = "" } = req.query;
        const filters = ["j.recruiter_id = ?"]; const params = [req.user.id];
        if (search.trim()) { filters.push("(u.full_name LIKE ? OR u.email LIKE ? OR j.job_title LIKE ? OR p.skills LIKE ?)"); const term = `%${search.trim()}%`; params.push(term, term, term, term); }
        if (job) { filters.push("j.id = ?"); params.push(Number(job)); }
        if (status) { filters.push("COALESCE(a.status, 'Applied') = ?"); params.push(status); }
        const [rows] = await pool.query(`SELECT a.id AS application_id, a.job_id, a.applicant_id, COALESCE(a.status, 'Applied') AS status, a.applied_at, a.cover_letter, j.job_title, j.company_name, u.full_name, u.email, u.phone, p.skills, p.education, p.graduation_year, p.experience, p.professional_summary FROM applications a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.applicant_id LEFT JOIN user_profiles p ON p.user_id = u.id WHERE ${filters.join(' AND ')} ORDER BY a.applied_at DESC`, params);
        res.json({ success: true, applications: rows });
    } catch (error) { console.error("Pipeline load error:", error); res.status(500).json({ message: "Unable to load recruitment pipeline" }); }
});

app.get("/api/recruiter/pipeline/:applicationId/activity", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access only" });
    try {
        const [rows] = await pool.query(`SELECT h.id, h.old_status, h.new_status, h.changed_at FROM application_status_history h JOIN applications a ON a.id = h.application_id JOIN jobs j ON j.id = a.job_id WHERE h.application_id = ? AND j.recruiter_id = ? ORDER BY h.changed_at DESC`, [req.params.applicationId, req.user.id]);
        res.json({ success: true, activity: rows });
    } catch (error) { console.error("Pipeline activity error:", error); res.status(500).json({ message: "Unable to load activity history. Run the Phase 12 SQL migration." }); }
});

app.get("/api/recruiter/analytics", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") {
        return res.status(403).json({ message: "Recruiter access only" });
    }
    try {
        const recruiterId = req.user.id;
        const [[summary]] = await pool.query(
            `SELECT COUNT(DISTINCT j.id) AS total_jobs,
                    COUNT(a.id) AS total_applications,
                    SUM(CASE WHEN a.status = 'Applied' OR a.status IS NULL THEN 1 ELSE 0 END) AS applied,
                    SUM(CASE WHEN a.status = 'Shortlisted' THEN 1 ELSE 0 END) AS shortlisted,
                    SUM(CASE WHEN a.status = 'Selected' THEN 1 ELSE 0 END) AS selected,
                    SUM(CASE WHEN a.status = 'Rejected' THEN 1 ELSE 0 END) AS rejected
             FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
             WHERE j.recruiter_id = ?`, [recruiterId]
        );
        const [jobRows] = await pool.query(
            `SELECT j.id, j.job_title, j.company_name, COUNT(a.id) AS applications,
                    SUM(CASE WHEN a.status = 'Shortlisted' THEN 1 ELSE 0 END) AS shortlisted,
                    SUM(CASE WHEN a.status = 'Selected' THEN 1 ELSE 0 END) AS selected
             FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
             WHERE j.recruiter_id = ?
             GROUP BY j.id, j.job_title, j.company_name
             ORDER BY applications DESC, j.id DESC`, [recruiterId]
        );
        const [monthlyRows] = await pool.query(
            `SELECT DATE_FORMAT(a.applied_at, '%Y-%m') AS month,
                    COUNT(*) AS applications
             FROM applications a JOIN jobs j ON a.job_id = j.id
             WHERE j.recruiter_id = ? AND a.applied_at >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
             GROUP BY DATE_FORMAT(a.applied_at, '%Y-%m') ORDER BY month ASC`, [recruiterId]
        );
        res.json({ success: true, summary: summary || {}, jobs: jobRows, monthly: monthlyRows });
    } catch (error) {
        console.error("Recruiter analytics error:", error);
        res.status(500).json({ message: "Unable to load recruiter analytics" });
    }
});


app.get("/api/applications/recruiter/jobs", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "recruiter") {
            return res.status(403).json({
                message: "Only recruiters can access this"
            });
        }

        const [jobs] = await pool.query(
            `SELECT id, job_title, company_name
             FROM jobs
             WHERE recruiter_id = ?
             ORDER BY id DESC`,
            [req.user.id]
        );

        res.json({
            success: true,
            jobs
        });

    } catch (error) {
        console.error("Recruiter jobs error:", error);

        res.status(500).json({
            message: "Failed to load recruiter jobs"
        });
    }
});


// 4. RECRUITER - VIEW APPLICANTS
app.get(
    "/api/applications/recruiter/jobs/:jobId/applications",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.role !== "recruiter") {
                return res.status(403).json({
                    message: "Only recruiters can view applicants"
                });
            }

            const jobId = req.params.jobId;
            const recruiterId = req.user.id;

            const [ownedJobs] = await pool.query(
                `SELECT id FROM jobs
                 WHERE id = ? AND recruiter_id = ?`,
                [jobId, recruiterId]
            );

            if (ownedJobs.length === 0) {
                return res.status(404).json({
                    message: "Job not found"
                });
            }

            const [applicants] = await pool.query(
                `SELECT
                    a.id AS application_id,
                    a.job_id,
                    a.applicant_id,
                    a.cover_letter,
                    a.status,
                    a.applied_at,
                    u.full_name,
                    u.email,
                    u.phone,
                    p.resume_path
                FROM applications a
                JOIN users u ON a.applicant_id = u.id
                LEFT JOIN user_profiles p ON p.user_id = u.id
                WHERE a.job_id = ?
                ORDER BY a.applied_at DESC`,
                [jobId]
            );

            res.json({
                success: true,
                applicants
            });

        } catch (error) {
            console.error("Applicants error:", error);

            res.status(500).json({
                message: "Failed to load applicants"
            });
        }
    }
);



// PHASE 6 - SECURE RECRUITER RESUME ACCESS
app.get("/api/applications/recruiter/:applicationId/resume", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "recruiter") {
            return res.status(403).json({ message: "Only recruiters can access applicant resumes" });
        }

        const [rows] = await pool.query(
            `SELECT p.resume_path
             FROM applications a
             JOIN jobs j ON j.id = a.job_id
             JOIN user_profiles p ON p.user_id = a.applicant_id
             WHERE a.id = ? AND j.recruiter_id = ?`,
            [req.params.applicationId, req.user.id]
        );

        if (!rows.length || !rows[0].resume_path) {
            return res.status(404).json({ message: "Resume not found for this application" });
        }

        const filename = path.basename(rows[0].resume_path);
        const filePath = path.join(resumeDirectory, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: "Resume file is missing" });
        }
        res.download(filePath, filename);
    } catch (error) {
        console.error("Recruiter resume access error:", error);
        res.status(500).json({ message: "Unable to access resume" });
    }
});

// 5. RECRUITER - UPDATE APPLICATION STATUS
app.put(
    "/api/applications/:applicationId/status",
    authenticateToken,
    async (req, res) => {
        try {
            if (req.user.role !== "recruiter") {
                return res.status(403).json({
                    message: "Only recruiters can update status"
                });
            }

            const applicationId = req.params.applicationId;
            const recruiterId = req.user.id;
            const { status } = req.body;

            const allowedStatuses = [
                "Applied",
                "Shortlisted",
                "Interview",
                "Selected",
                "Hired",
                "Rejected"
            ];

            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({
                    message: "Invalid status"
                });
            }

            const [applicationRows] = await pool.query(
                `SELECT a.applicant_id, a.status AS old_status, j.job_title
                 FROM applications a
                 JOIN jobs j ON a.job_id = j.id
                 WHERE a.id = ? AND j.recruiter_id = ?`,
                [applicationId, recruiterId]
            );

            if (applicationRows.length === 0) {
                return res.status(404).json({
                    message: "Application not found or unauthorized"
                });
            }

            const [result] = await pool.query(
                `UPDATE applications a
                 JOIN jobs j ON a.job_id = j.id
                 SET a.status = ?
                 WHERE a.id = ?
                 AND j.recruiter_id = ?`,
                [status, applicationId, recruiterId]
            );


            if (applicationRows[0].old_status !== status) {
                try { await pool.query("INSERT INTO application_status_history (application_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)", [applicationId, applicationRows[0].old_status || "Applied", status, recruiterId]); } catch (historyError) { console.error("Application history insert error:", historyError); }
                try {
                    await pool.query(
                        `INSERT INTO notifications (user_id, title, message, type, related_job_id, related_application_id)
                         SELECT ?, ?, ?, ?, a.job_id, a.id
                         FROM applications a WHERE a.id = ?`,
                        [applicationRows[0].applicant_id, "Application Status Updated", `Your application for ${applicationRows[0].job_title} is now ${status}.`, "status", applicationId]
                    );
                } catch (notificationError) {
                    console.error("Status notification insert error:", notificationError);
                }
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Application not found or unauthorized"
                });
            }

            res.json({
                success: true,
                message: "Status updated successfully",
                status
            });

        } catch (error) {
            console.error("Status update error:", error);

            res.status(500).json({
                message: "Failed to update application status"
            });
        }
    }
);

// ======================================
// RECRUITER CANDIDATE SEARCH & SHORTLIST
// ======================================
app.get("/api/recruiter/candidates", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Only recruiters can search candidates" });
    try {
        const search = String(req.query.search || "").trim();
        const skill = String(req.query.skill || "").trim();
        const education = String(req.query.education || "").trim();
        const params = [];
        let where = "WHERE u.role = 'seeker'";
        if (search) { where += " AND (u.full_name LIKE ? OR p.skills LIKE ? OR p.education LIKE ?)"; const term = `%${search}%`; params.push(term, term, term); }
        if (skill) { where += " AND p.skills LIKE ?"; params.push(`%${skill}%`); }
        if (education) { where += " AND p.education LIKE ?"; params.push(`%${education}%`); }
        const [rows] = await pool.query(`SELECT u.id, u.full_name, p.professional_summary, p.education, p.graduation_year, p.skills, p.experience, CASE WHEN p.resume_path IS NOT NULL AND p.resume_path <> '' THEN 1 ELSE 0 END AS has_resume FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ${where} ORDER BY u.full_name ASC LIMIT 100`, params);
        const [shortlistRows] = await pool.query("SELECT candidate_id FROM recruiter_shortlists WHERE recruiter_id = ?", [req.user.id]);
        const shortlisted = new Set(shortlistRows.map(row => Number(row.candidate_id)));
        res.json({ success: true, candidates: rows.map(row => ({ ...row, is_shortlisted: shortlisted.has(Number(row.id)) })) });
    } catch (error) { console.error("Candidate search error:", error); res.status(500).json({ message: "Candidate search failed" }); }
});
app.get("/api/recruiter/candidates/:candidateId/profile", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    const candidateId = Number(req.params.candidateId);
    if (!Number.isInteger(candidateId) || candidateId < 1) return res.status(400).json({ message: "Invalid candidate ID" });
    try {
        const [rows] = await pool.query(`SELECT u.id, u.full_name, u.email, u.phone, p.professional_summary, p.education, p.graduation_year, p.skills, p.experience, CASE WHEN p.resume_path IS NOT NULL AND p.resume_path <> '' THEN 1 ELSE 0 END AS has_resume FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'seeker'`, [candidateId]);
        if (!rows.length) return res.status(404).json({ message: "Candidate not found" });
        res.json({ success: true, profile: rows[0] });
    } catch (error) { console.error("Candidate profile error:", error); res.status(500).json({ message: "Failed to load candidate profile" }); }
});

app.get("/api/recruiter/shortlist", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    try {
        const [rows] = await pool.query(`SELECT u.id, u.full_name, p.professional_summary, p.education, p.graduation_year, p.skills, p.experience, CASE WHEN p.resume_path IS NOT NULL AND p.resume_path <> '' THEN 1 ELSE 0 END AS has_resume FROM recruiter_shortlists s JOIN users u ON u.id = s.candidate_id LEFT JOIN user_profiles p ON p.user_id = u.id WHERE s.recruiter_id = ? AND u.role = 'seeker' ORDER BY s.created_at DESC`, [req.user.id]);
        res.json({ success: true, candidates: rows });
    } catch (error) { console.error("Shortlist load error:", error); res.status(500).json({ message: "Failed to load shortlist" }); }
});
app.post("/api/recruiter/shortlist/:candidateId", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    const candidateId = Number(req.params.candidateId);
    if (!Number.isInteger(candidateId) || candidateId < 1) return res.status(400).json({ message: "Invalid candidate ID" });
    try {
        const [candidates] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'seeker'", [candidateId]);
        if (!candidates.length) return res.status(404).json({ message: "Candidate not found" });
        const [insertResult] = await pool.query("INSERT IGNORE INTO recruiter_shortlists (recruiter_id, candidate_id) VALUES (?, ?)", [req.user.id, candidateId]);
        if (insertResult.affectedRows) {
            try {
                const [recruiterRows] = await pool.query("SELECT full_name FROM users WHERE id = ?", [req.user.id]);
                const recruiterName = recruiterRows[0]?.full_name || "A recruiter";
                await pool.query("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)", [candidateId, "You have been shortlisted", `${recruiterName} has shortlisted your profile. Check your applications and notifications for updates.`, "shortlist"]);
            } catch (notificationError) { console.error("Shortlist notification error:", notificationError); }
        }
        res.json({ success: true, message: insertResult.affectedRows ? "Candidate added to shortlist and notified" : "Candidate is already shortlisted" });
    } catch (error) { console.error("Shortlist add error:", error); res.status(500).json({ message: "Failed to shortlist candidate" }); }
});
app.delete("/api/recruiter/shortlist/:candidateId", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    try {
        await pool.query("DELETE FROM recruiter_shortlists WHERE recruiter_id = ? AND candidate_id = ?", [req.user.id, Number(req.params.candidateId)]);
        res.json({ success: true, message: "Candidate removed from shortlist" });
    } catch (error) { console.error("Shortlist remove error:", error); res.status(500).json({ message: "Failed to remove candidate" }); }
});

// ======================================
// USER PROFILE MANAGEMENT
// ======================================

// GET USER PROFILE
app.get("/api/profile", authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
                u.id,
                u.full_name,
                u.email,
                u.phone,
                p.professional_summary,
                p.education,
                p.graduation_year,
                p.skills,
                p.experience,
                p.resume_path,
                p.updated_at
            FROM users u
            LEFT JOIN user_profiles p ON p.user_id = u.id
            WHERE u.id = ?`,
            [req.user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.json({
            success: true,
            profile: rows[0]
        });

    } catch (error) {
        console.error("Get profile error:", error);

        res.status(500).json({
            message: "Failed to load profile"
        });
    }
});


// UPDATE USER PROFILE
app.put("/api/profile", authenticateToken, async (req, res) => {
    try {
        const {
            full_name,
            phone,
            professional_summary,
            education,
            graduation_year,
            skills,
            experience
        } = req.body;

        if (!full_name || !full_name.trim()) {
            return res.status(400).json({
                message: "Full name is required"
            });
        }

        // Update basic user details
        await pool.query(
            `UPDATE users
             SET full_name = ?, phone = ?
             WHERE id = ?`,
            [
                full_name.trim(),
                phone || null,
                req.user.id
            ]
        );

        // Create profile if it does not exist, otherwise update it
        await pool.query(
            `INSERT INTO user_profiles
            (
                user_id,
                professional_summary,
                education,
                graduation_year,
                skills,
                experience
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                professional_summary = VALUES(professional_summary),
                education = VALUES(education),
                graduation_year = VALUES(graduation_year),
                skills = VALUES(skills),
                experience = VALUES(experience)`,
            [
                req.user.id,
                professional_summary || null,
                education || null,
                graduation_year || null,
                skills || null,
                experience || null
            ]
        );

        res.json({
            success: true,
            message: "Profile updated successfully"
        });

    } catch (error) {
        console.error("Update profile error:", error);

        res.status(500).json({
            message: "Failed to update profile"
        });
    }
});


// UPLOAD RESUME
app.post(
    "/api/profile/resume",
    authenticateToken,
    upload.single("resume"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    message: "Please select a resume file"
                });
            }

            const resumePath = "/uploads/resumes/" + req.file.filename;

            await pool.query(
                `INSERT INTO user_profiles (user_id, resume_path)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE resume_path = VALUES(resume_path)`,
                [req.user.id, resumePath]
            );

            res.json({
                success: true,
                message: "Resume uploaded successfully",
                resume_path: resumePath
            });

        } catch (error) {
            console.error("Resume upload error:", error);

            res.status(500).json({
                message: "Resume upload failed"
            });
        }
    }
);

// PHASE 6 - AUTHENTICATED SEEKER RESUME DOWNLOAD
app.get("/api/profile/resume", authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT resume_path FROM user_profiles WHERE user_id = ?", [req.user.id]);
        if (!rows.length || !rows[0].resume_path) return res.status(404).json({ message: "Resume not found" });
        const filename = path.basename(rows[0].resume_path);
        const filePath = path.join(resumeDirectory, filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Resume file is missing" });
        res.download(filePath, filename);
    } catch (error) {
        console.error("Seeker resume download error:", error);
        res.status(500).json({ message: "Unable to download resume" });
    }
});

// ======================================
// PHASE 2 - SAVED JOBS
// ======================================

// GET SAVED JOBS
app.get("/api/saved-jobs", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "seeker") {
            return res.status(403).json({
                message: "Only job seekers can view saved jobs"
            });
        }

        const [savedJobs] = await pool.query(
            `SELECT
                sj.id AS saved_id,
                sj.saved_at,
                j.id AS job_id,
                j.job_title,
                j.company_name,
                j.location,
                j.job_type,
                j.salary,
                j.skills,
                j.description
            FROM saved_jobs sj
            JOIN jobs j ON sj.job_id = j.id
            WHERE sj.user_id = ?
            ORDER BY sj.saved_at DESC`,
            [req.user.id]
        );

        res.json({
            success: true,
            savedJobs
        });

    } catch (error) {
        console.error("Get saved jobs error:", error);

        res.status(500).json({
            message: "Failed to load saved jobs"
        });
    }
});


// SAVE A JOB
app.post("/api/saved-jobs", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "seeker") {
            return res.status(403).json({
                message: "Only job seekers can save jobs"
            });
        }

        const { job_id } = req.body;

        if (!job_id) {
            return res.status(400).json({
                message: "Job ID is required"
            });
        }

        const [jobs] = await pool.execute(
            "SELECT id FROM jobs WHERE id = ?",
            [job_id]
            );

        if (jobs.length === 0) {
            return res.status(404).json({
                message: "Job not found"
            });
        }

        const [existing] = await pool.execute(
            `SELECT id FROM saved_jobs
             WHERE user_id = ? AND job_id = ?`,
            [req.user.id, job_id]
        );

        if (existing.length > 0) {
            return res.json({
                success: true,
                message: "Job is already saved"
            });
        }

        await pool.execute(
            `INSERT INTO saved_jobs (user_id, job_id)
             VALUES (?, ?)`,
            [req.user.id, job_id]
        );

        res.status(201).json({
            success: true,
            message: "Job saved successfully"
        });

    } catch (error) {
        console.error("Save job error:", error);

        res.status(500).json({
            message: "Failed to save job"
        });
    }
});


// REMOVE SAVED JOB
app.delete("/api/saved-jobs/:jobId", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "seeker") {
            return res.status(403).json({
                message: "Only job seekers can remove saved jobs"
            });
        }

        const [result] = await pool.execute(
            `DELETE FROM saved_jobs
             WHERE user_id = ? AND job_id = ?`,
            [req.user.id, req.params.jobId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Saved job not found"
            });
        }

        res.json({
            success: true,
            message: "Saved job removed"
        });

    } catch (error) {
        console.error("Remove saved job error:", error);

        res.status(500).json({
            message: "Failed to remove saved job"
        });
    }
});

// ======================================
// PHASE 3 - NOTIFICATIONS
// ======================================

// List notifications and unread count for the logged-in user
app.get("/api/notifications", authenticateToken, async (req, res) => {
    try {
        const [notifications] = await pool.query(
            `SELECT id, title, message, type, related_job_id, related_application_id, is_read, created_at
             FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
            [req.user.id]
        );
        const unreadCount = notifications.filter(n => !n.is_read).length;
        res.json({ success: true, notifications, unreadCount });
    } catch (error) {
        console.error("Notifications load error:", error);
        res.status(500).json({ message: "Failed to load notifications" });
    }
});

// Mark one notification as read (only its owner can update it)
app.patch("/api/notifications/:id/read", authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query(
            `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
            [req.params.id, req.user.id]
        );
        if (!result.affectedRows) return res.status(404).json({ message: "Notification not found" });
        res.json({ success: true, message: "Notification marked as read" });
    } catch (error) {
        console.error("Mark notification read error:", error);
        res.status(500).json({ message: "Failed to update notification" });
    }
});

// Mark all notifications as read
app.put("/api/notifications/read-all", authenticateToken, async (req, res) => {
    try {
        await pool.query(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.user.id]);
        res.json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
        console.error("Mark all notifications read error:", error);
        res.status(500).json({ message: "Failed to update notifications" });
    }
});

// Delete one notification (only its owner can delete it)
app.delete("/api/notifications/:id", authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query(
            `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
            [req.params.id, req.user.id]
        );
        if (!result.affectedRows) return res.status(404).json({ message: "Notification not found" });
        res.json({ success: true, message: "Notification deleted" });
    } catch (error) {
        console.error("Delete notification error:", error);
        res.status(500).json({ message: "Failed to delete notification" });
    }
});


// ======================================
// PHASE 4 - ADMIN PANEL API
// ======================================
app.get("/api/admin/stats", authenticateToken, requireRole("admin"), async (req, res) => {
    try {
        const [[users]] = await pool.query("SELECT COUNT(*) AS total FROM users");
        const [[jobs]] = await pool.query("SELECT COUNT(*) AS total FROM jobs");
        const [[applications]] = await pool.query("SELECT COUNT(*) AS total FROM applications");
        const [[seekers]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'seeker'");
        const [[recruiters]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'recruiter'");
        res.json({ users: users.total, jobs: jobs.total, applications: applications.total, seekers: seekers.total, recruiters: recruiters.total });
    } catch (error) {
        console.error("Admin stats error:", error);
        res.status(500).json({ message: "Unable to load admin statistics" });
    }
});


app.get("/api/admin/users", authenticateToken, requireRole("admin"), async (req, res) => {
    try {
        const [users] = await pool.query("SELECT id, full_name, email, phone, role FROM users ORDER BY id DESC");
        res.json(users);
    } catch (error) {
        console.error("Admin users error:", error);
        res.status(500).json({ message: "Unable to load users" });
    }
});


app.get("/api/admin/jobs", authenticateToken, requireRole("admin"), async (req, res) => {
    try {
        const [jobs] = await pool.query(
            `SELECT j.*, u.full_name AS recruiter_name, u.email AS recruiter_email
             FROM jobs j JOIN users u ON j.recruiter_id = u.id
             ORDER BY j.created_at DESC`
        );
        res.json(jobs);
    } catch (error) {
        console.error("Admin jobs error:", error);
        res.status(500).json({ message: "Unable to load jobs" });
    }
});


app.delete("/api/admin/jobs/:id", authenticateToken, requireRole("admin"), async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const jobId = req.params.id;
        const [jobs] = await connection.query("SELECT id FROM jobs WHERE id = ?", [jobId]);
        if (!jobs.length) {
            await connection.rollback();
            return res.status(404).json({ message: "Job not found" });
        }
        await connection.query("DELETE FROM notifications WHERE related_job_id = ?", [jobId]);
        await connection.query("DELETE FROM saved_jobs WHERE job_id = ?", [jobId]);
        await connection.query("DELETE FROM applications WHERE job_id = ?", [jobId]);
        await connection.query("DELETE FROM jobs WHERE id = ?", [jobId]);
        await connection.commit();
        res.json({ success: true, message: "Job removed by admin" });
    } catch (error) {
        await connection.rollback();
        console.error("Admin delete job error:", error);
        res.status(500).json({ message: "Unable to delete job" });
    } finally {
        connection.release();
    }
});


app.delete("/api/admin/users/:id", authenticateToken, requireRole("admin"), async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ message: "Invalid user ID" });
    if (targetId === Number(req.user.id)) return res.status(400).json({ message: "You cannot delete your own admin account" });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [targetRows] = await connection.query("SELECT id, role FROM users WHERE id = ?", [targetId]);
        if (!targetRows.length) {
            await connection.rollback();
            return res.status(404).json({ message: "User not found" });
        }
        if (targetRows[0].role === "admin") {
            await connection.rollback();
            return res.status(403).json({ message: "Admin accounts cannot be deleted from this panel" });
        }
        await connection.query("DELETE FROM notifications WHERE user_id = ? OR related_job_id IN (SELECT id FROM jobs WHERE recruiter_id = ?)", [targetId, targetId]);
        await connection.query("DELETE FROM saved_jobs WHERE user_id = ? OR job_id IN (SELECT id FROM jobs WHERE recruiter_id = ?)", [targetId, targetId]);
        await connection.query("DELETE FROM applications WHERE applicant_id = ? OR job_id IN (SELECT id FROM jobs WHERE recruiter_id = ?)", [targetId, targetId]);
        await connection.query("DELETE FROM jobs WHERE recruiter_id = ?", [targetId]);
        await connection.query("DELETE FROM users WHERE id = ?", [targetId]);
        await connection.commit();
        res.json({ success: true, message: "User and related records deleted" });
    } catch (error) {
        await connection.rollback();
        console.error("Admin delete user error:", error);
        res.status(500).json({ message: "Unable to delete user" });
    } finally {
        connection.release();
    }
});

// GENERAL ERROR HANDLER
app.use((err, req, res, next) => {
    console.error(err.message);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            message: err.message
        });
    }

    res.status(400).json({
        message: err.message || "Something went wrong"
    });
});

// ======================================
// PHASE 10: JOB SEEKER INTERVIEW VIEW
// Recruiters' private notes are excluded from this endpoint.
app.get("/api/seeker/interviews", authenticateToken, async (req, res) => {
    if (req.user.role !== "seeker") return res.status(403).json({ message: "Only job seekers can view their interviews" });
    try {
        const [rows] = await pool.query(`
            SELECT i.id, i.application_id, i.scheduled_at, i.interview_type, i.meeting_link, i.status,
                   j.job_title, j.company_name
            FROM recruiter_interviews i
            JOIN applications a ON a.id = i.application_id
            JOIN jobs j ON j.id = a.job_id
            WHERE a.applicant_id = ?
            ORDER BY i.scheduled_at DESC
        `, [req.user.id]);
        res.json({ success: true, interviews: rows });
    } catch (error) {
        console.error("Seeker interviews error:", error);
        res.status(500).json({ message: "Failed to load your interviews" });
    }
});

// PHASE 9: RECRUITER INTERVIEW MANAGEMENT
// ======================================
app.get("/api/recruiter/interview-applications", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    try {
        const [rows] = await pool.query(`SELECT a.id AS application_id, u.full_name, u.email, j.job_title, a.status AS application_status FROM applications a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.applicant_id WHERE j.recruiter_id = ? AND a.status NOT IN ('Selected', 'Rejected') ORDER BY a.applied_at DESC`, [req.user.id]);
        res.json({ success: true, applications: rows });
    } catch (error) { console.error("Interview applications error:", error); res.status(500).json({ message: "Failed to load applications" }); }
});
app.get("/api/recruiter/interviews", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    try {
        const [rows] = await pool.query(`SELECT i.id, i.application_id, i.scheduled_at, i.interview_type, i.meeting_link, i.notes, i.status, i.created_at, u.full_name, u.email, j.job_title FROM recruiter_interviews i JOIN applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.applicant_id WHERE i.recruiter_id = ? ORDER BY i.scheduled_at DESC`, [req.user.id]);
        res.json({ success: true, interviews: rows });
    } catch (error) { console.error("Interview list error:", error); res.status(500).json({ message: "Failed to load interviews" }); }
});
app.post("/api/recruiter/interviews", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    const applicationId = Number(req.body.application_id);
    const scheduledAt = String(req.body.scheduled_at || "").trim();
    const interviewType = String(req.body.interview_type || "Online").trim();
    const meetingLink = String(req.body.meeting_link || "").trim();
    const notes = String(req.body.notes || "").trim();
    if (!Number.isInteger(applicationId) || applicationId < 1 || !scheduledAt) return res.status(400).json({ message: "Choose an application and interview date/time" });
    if (! ["Online", "Phone", "In-person"].includes(interviewType)) return res.status(400).json({ message: "Invalid interview type" });
    try {
        const [owned] = await pool.query(`SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ? AND j.recruiter_id = ?`, [applicationId, req.user.id]);
        if (!owned.length) return res.status(404).json({ message: "Application not found for your jobs" });
        const date = new Date(scheduledAt); if (Number.isNaN(date.getTime())) return res.status(400).json({ message: "Invalid interview date/time" });
        await pool.query(`INSERT INTO recruiter_interviews (recruiter_id, application_id, scheduled_at, interview_type, meeting_link, notes, status) VALUES (?, ?, ?, ?, ?, ?, 'Scheduled')`, [req.user.id, applicationId, date, interviewType, meetingLink || null, notes || null]);
        // Notify the applicant that an interview has been scheduled. Notification failure does not undo scheduling.
        try {
            const [applicantRows] = await pool.query(`SELECT a.applicant_id, a.job_id, j.job_title, j.company_name FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`, [applicationId]);
            if (applicantRows.length) {
                const applicant = applicantRows[0];
                await pool.query(`INSERT INTO notifications (user_id, title, message, type, related_job_id, related_application_id) VALUES (?, ?, ?, ?, ?, ?)`, [applicant.applicant_id, "Interview Scheduled", `An interview has been scheduled for ${applicant.job_title} at ${applicant.company_name}. Check your dashboard for details.`, "interview", applicant.job_id, applicationId]);
            }
        } catch (notificationError) { console.error("Interview notification error:", notificationError); }
        res.status(201).json({ success: true, message: "Interview scheduled successfully" });
    } catch (error) { console.error("Interview schedule error:", error); res.status(500).json({ message: "Failed to schedule interview" }); }
});
app.patch("/api/recruiter/interviews/:id/status", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    const allowed = ["Scheduled", "Completed", "Cancelled", "Rescheduled"]; const status = String(req.body.status || "");
    if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid interview status" });
    try {
        const interviewId = Number(req.params.id);
        const [owned] = await pool.query(`SELECT i.application_id, a.applicant_id, a.job_id, j.job_title FROM recruiter_interviews i JOIN applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id WHERE i.id = ? AND i.recruiter_id = ?`, [interviewId, req.user.id]);
        if (!owned.length) return res.status(404).json({ message: "Interview not found" });
        const [result] = await pool.query("UPDATE recruiter_interviews SET status = ? WHERE id = ? AND recruiter_id = ?", [status, interviewId, req.user.id]);
        if (!result.affectedRows) return res.status(404).json({ message: "Interview not found" });
        try { await pool.query(`INSERT INTO notifications (user_id, title, message, type, related_job_id, related_application_id) VALUES (?, ?, ?, ?, ?, ?)`, [owned[0].applicant_id, "Interview Status Updated", `Your interview for ${owned[0].job_title} is now ${status}.`, "interview", owned[0].job_id, owned[0].application_id]); } catch (notificationError) { console.error("Interview status notification error:", notificationError); }
        res.json({ success: true, message: "Interview status updated" });
    }
    catch (error) { console.error("Interview status update error:", error); res.status(500).json({ message: "Failed to update interview status" }); }
});
app.delete("/api/recruiter/interviews/:id", authenticateToken, async (req, res) => {
    if (req.user.role !== "recruiter") return res.status(403).json({ message: "Recruiter access required" });
    try { const [result] = await pool.query("DELETE FROM recruiter_interviews WHERE id = ? AND recruiter_id = ?", [Number(req.params.id), req.user.id]); if (!result.affectedRows) return res.status(404).json({ message: "Interview not found" }); res.json({ success: true, message: "Interview deleted" }); }
    catch (error) { console.error("Interview delete error:", error); res.status(500).json({ message: "Failed to delete interview" }); }
});

// START SERVER
async function startServer() {
    try {
        await testDatabase();

        app.listen(PORT, () => {
            console.log("----------------------------------");
            console.log("SmartHire backend is running");
            console.log(`http://localhost:${PORT}`);
            console.log("----------------------------------");
        });

    } catch (error) {
        console.error("Unable to connect to MySQL");
        console.error(error.message);
        process.exit(1);
    }
}

startServer();
