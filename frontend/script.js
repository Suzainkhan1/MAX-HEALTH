// ─── API BASE URL ────────────────────────────────────────────────────────────
// Automatically uses localhost in development and the Render backend in prod.
// TO DEPLOY: set your Render service URL below (no trailing slash).
const RENDER_BACKEND_URL = 'https://max-health-1.onrender.com';

const API_BASE_URL = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
)
  ? 'http://localhost:3000'
  : RENDER_BACKEND_URL;

console.log('[API] Base URL:', API_BASE_URL);
// ─────────────────────────────────────────────────────────────────────────────

// ================= GLOBAL STATE =================
let appState = {
    user: null,
    token: null,
    role: 'user', // Default
    authOpen: false,
    sidebarOpen: false,
    adminOverlayOpen: false,
    reduceMotion: false
};

// ================= FIREBASE INIT =================
const firebaseConfig = {
    apiKey: "AIzaSyCykaC3C4w3i9IeEFUw4Rj4lJWrfS6rUU0",
    authDomain: "gym-management-a2ea0.firebaseapp.com",
    projectId: "gym-management-a2ea0",
    storageBucket: "gym-management-a2ea0.firebasestorage.app",
    messagingSenderId: "807411949129",
    appId: "1:807411949129:web:5dc2e9bcde801c4831a998"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// ================= UTILITIES =================
function showLoader() { document.getElementById('global-loader').style.display = 'flex'; }
function hideLoader() { document.getElementById('global-loader').style.display = 'none'; }

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Network Detection
window.addEventListener('online', () => { document.getElementById('offline-banner').style.display = 'none'; });
window.addEventListener('offline', () => { document.getElementById('offline-banner').style.display = 'block'; });

// Centralized API Wrapper
async function api(endpoint, method = 'GET', body = null) {
    if (!navigator.onLine) {
        showToast("You are offline. Please check your connection.", "error");
        throw new Error("Offline");
    }

    if (appState.user) {
        try {
            appState.token = await appState.user.getIdToken(true);
        } catch (e) {
            console.error("Token refresh failed", e);
        }
    }

    const headers = { 'Content-Type': 'application/json' };
    if (appState.token) headers['Authorization'] = `Bearer ${appState.token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        const data = await res.json();
        
        if (!res.ok || !data.success) throw new Error(data.error || "API Error");
        return data;
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

// ================= AUTHENTICATION =================
auth.onAuthStateChanged(async (user) => {
    appState.user = user;
    if (user) {
        appState.token = await user.getIdToken();
        try {
            const docSnap = await db.collection("users").doc(user.uid).get();
            if (docSnap.exists) {
                appState.role = docSnap.data().role || 'user';
            }
        } catch(e) { appState.role = 'user'; }
        updateUIAfterLogin();
    } else {
        appState.token = null;
        appState.role = 'user';
        updateUIAfterLogout();
    }
});

function openAuthModal() {
    document.getElementById("auth-overlay").classList.add("show");
    switchAuthView('login');
}
function closeAuthModal() { document.getElementById("auth-overlay").classList.remove("show"); }

function switchAuthView(view) {
    const loginForm = document.getElementById('login-form');
    const forgotForm = document.getElementById('forgot-pw-form');
    const signupFields = document.getElementById('signup-fields');
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-primary-btn');
    const toggle = document.getElementById('auth-toggle-container');
    const orDivider = document.getElementById('auth-or-divider');
    const googleBtn = document.getElementById('auth-google-btn');
    const forgotLink = document.getElementById('forgot-pw-link');

    if (view === 'login') {
        loginForm.style.display = 'block'; forgotForm.style.display = 'none'; signupFields.style.display = 'none';
        title.innerText = "Login"; btn.innerText = "Sign In"; btn.onclick = login;
        toggle.innerHTML = `<p>Don't have an account? <span onclick="switchAuthView('signup')">Sign up here</span></p>`;
        orDivider.style.display = 'flex'; googleBtn.style.display = 'flex'; forgotLink.style.display = 'block';
    } else if (view === 'signup') {
        loginForm.style.display = 'block'; forgotForm.style.display = 'none'; signupFields.style.display = 'block';
        title.innerText = "Sign Up"; btn.innerText = "Create Account"; btn.onclick = signup;
        toggle.innerHTML = `<p>Already have an account? <span onclick="switchAuthView('login')">Login here</span></p>`;
        orDivider.style.display = 'none'; googleBtn.style.display = 'none'; forgotLink.style.display = 'none';
    } else if (view === 'forgot') {
        loginForm.style.display = 'none'; forgotForm.style.display = 'block';
        title.innerText = "Reset Password";
        toggle.innerHTML = "";
    }
}

async function signup() {
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;
    const name = document.getElementById("fullname").value;
    const contact = document.getElementById("contact").value;
    const address = document.getElementById("address").value;
    const plan = document.getElementById("plan-select").value;

    if (!email || !password || !name || !contact || !address || !plan) return showToast("Fill all fields", "error");
    
    showLoader();
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const userData = { uid: cred.user.uid, name, email, contact, address, plan, paymentStatus: "Unpaid", joinDate: new Date().toISOString(), lastPaymentDate: null, role: 'user' };
        await api('/api/signup', 'POST', userData);
        showToast("Account created!");
        closeAuthModal();
        api('/api/analytics', 'POST', { type: 'signup', data: { uid: cred.user.uid }}).catch(()=>{});
    } catch (err) {
        showToast(err.message, "error");
    } finally { hideLoader(); }
}

async function login() {
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;
    if (!email || !password) return showToast("Fill all fields", "error");

    const btn = document.getElementById('auth-primary-btn');
    btn.disabled = true; btn.innerText = "Loading...";
    try {
        await auth.signInWithEmailAndPassword(email, password);
        showToast("Logged in!");
        closeAuthModal();
        api('/api/analytics', 'POST', { type: 'login', data: { email }}).catch(()=>{});
    } catch (err) {
        showToast("Login failed. Check credentials.", "error");
    } finally { btn.disabled = false; btn.innerText = "Sign In"; }
}

async function signInWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const res = await auth.signInWithPopup(provider);
        const doc = await db.collection("users").doc(res.user.uid).get();
        if (!doc.exists) {
            switchAuthView('signup');
            document.getElementById("auth-email").value = res.user.email;
            document.getElementById("auth-email").disabled = true;
            document.getElementById("auth-password").style.display = 'none';
            document.getElementById('auth-primary-btn').onclick = async () => {
                showLoader();
                const userData = {
                    uid: res.user.uid, name: document.getElementById("fullname").value, email: res.user.email,
                    contact: document.getElementById("contact").value, address: document.getElementById("address").value,
                    plan: document.getElementById("plan-select").value, paymentStatus: "Unpaid", joinDate: new Date().toISOString(), lastPaymentDate: null, role: 'user'
                };
                await api('/api/signup', 'POST', userData);
                hideLoader(); closeAuthModal(); updateUIAfterLogin();
            };
        } else {
            showToast("Logged in!"); closeAuthModal();
        }
    } catch (err) { showToast(err.message, "error"); }
}

function logout() {
    auth.signOut().then(() => { showToast("Logged out"); closeSidebar(); toggleAdminDashboard(false); });
}

// ================= OTP FLOW =================
async function sendOtp() {
    const email = document.getElementById("forgot-email").value;
    if (!email) return showToast("Enter email", "error");
    
    const btn = document.getElementById('send-otp-btn'); btn.disabled = true; btn.innerText = "Sending...";
    try {
        await api('/api/auth/forgot-password/send-otp', 'POST', { email });
        showToast("OTP sent to your email!");
        document.getElementById('otp-section').style.display = 'block';
    } catch (err) {
        showToast(err.message, "error");
    } finally { btn.disabled = false; btn.innerText = "Send OTP"; }
}

async function verifyOtpAndReset() {
    const email = document.getElementById("forgot-email").value;
    const otp = document.getElementById("forgot-otp").value;
    const password = document.getElementById("forgot-new-password").value;
    
    if (!otp || !password) return showToast("Enter OTP and new password", "error");
    if (password.length < 6) return showToast("Password must be at least 6 characters", "error");

    showLoader();
    try {
        await api('/api/auth/forgot-password/verify-otp', 'POST', { email, otp });
        await api('/api/auth/forgot-password/reset', 'POST', { email, password });
        showToast("Password reset successful!");
        if (appState.user) {
            closeSidebar();
        } else {
            switchAuthView('login');
        }
    } catch (err) {
        showToast(err.message, "error");
    } finally { hideLoader(); }
}

function triggerProfileForgotPW() {
    closeSidebar();
    openAuthModal();
    switchAuthView('forgot');
    document.getElementById("forgot-email").value = appState.user.email;
}

// ================= UI STATE UPDATES (ROLE BASED UNIFIED VIEW) =================
async function updateUIAfterLogin() {
    document.getElementById("nav-auth-btn").style.display = 'none';

    try {
        const docSnap = await db.collection("users").doc(appState.user.uid).get();
        const name = docSnap.exists ? docSnap.data().name.split(' ')[0] : 'User';
        document.getElementById("nav-greeting").innerHTML = `Welcome, <span class="text-accent">${name}</span>`;

        if (appState.role === 'admin') {
            // ADMIN NAV: Hide user links, show admin links. Landing page remains visible!
            document.querySelectorAll('.user-link').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.admin-link').forEach(el => el.style.display = 'inline-block');
            document.getElementById("nav-profile-btn").style.display = 'none';
            document.getElementById("nav-logout-admin-btn").style.display = 'inline-block';
        } else {
            // USER NAV
            document.querySelectorAll('.admin-link').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.user-link').forEach(el => el.style.display = 'inline-block');
            document.getElementById("nav-profile-btn").style.display = 'inline-block';
            document.getElementById("nav-logout-admin-btn").style.display = 'none';
            loadUserProfile();
        }
    } catch(e) {
        document.getElementById("nav-greeting").innerHTML = `Welcome`;
    }
}

function updateUIAfterLogout() {
    document.getElementById("nav-auth-btn").style.display = 'inline-block';
    document.getElementById("nav-profile-btn").style.display = 'none';
    document.getElementById("nav-logout-admin-btn").style.display = 'none';
    document.getElementById("nav-greeting").innerHTML = `MAX <span class="text-accent">HEALTH</span>`;
    
    document.querySelectorAll('.admin-link').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.user-link').forEach(el => el.style.display = 'inline-block');
    toggleAdminDashboard(false);
}

function toggleSidebar() {
    const sidebar = document.getElementById("user-sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    appState.sidebarOpen = !appState.sidebarOpen;
    sidebar.classList.toggle("open", appState.sidebarOpen);
    overlay.classList.toggle("show", appState.sidebarOpen);
}
function closeSidebar() { appState.sidebarOpen = false; document.getElementById("user-sidebar").classList.remove("open"); document.getElementById("sidebar-overlay").classList.remove("show"); }

async function loadUserProfile() {
    if (!appState.user || appState.role === 'admin') return;
    try {
        const docSnap = await db.collection("users").doc(appState.user.uid).get();
        if (docSnap.exists) {
            const data = docSnap.data();
            document.getElementById("user-name").innerText = data.name;
            document.getElementById("user-plan").innerText = data.plan;
            document.getElementById("user-joined").innerText = new Date(data.joinDate).toLocaleDateString();
            
            const isPaid = data.paymentStatus === 'Paid';
            const paymentEl = document.getElementById("user-payment");
            paymentEl.innerText = isPaid ? "Paid" : "Unpaid";
            paymentEl.className = "value status-badge " + (isPaid ? "paid" : "pending");
            document.getElementById("pay-now-btn").style.display = isPaid ? "none" : "block";

            // Progress Bar Logic
            let daysRemaining = 0;
            if (isPaid && data.lastPaymentDate) {
                const diffTime = Math.abs(new Date() - new Date(data.lastPaymentDate));
                const daysPassed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                daysRemaining = Math.max(0, 30 - daysPassed);
            }
            const progressEl = document.getElementById("expiry-progress");
            const progressText = document.getElementById("days-remaining-text");
            progressText.innerText = `${daysRemaining} Days Remaining`;
            const percentage = (daysRemaining / 30) * 100;
            progressEl.style.width = `${percentage}%`;
            if(percentage < 20) progressEl.style.background = 'linear-gradient(90deg, #ff9900, #ff0000)';
        }
    } catch(err) { console.error("Profile load error", err); }
}

async function changePassword() {
    const oldP = document.getElementById("change-old-pw").value;
    const newP = document.getElementById("change-new-pw").value;
    const confirmP = document.getElementById("change-confirm-pw").value;
    
    if(!oldP || !newP || !confirmP) return showToast("Fill all fields", "error");
    if(newP.length < 6) return showToast("New password must be at least 6 characters", "error");
    if(newP !== confirmP) return showToast("Passwords do not match", "error");

    try {
        const cred = firebase.auth.EmailAuthProvider.credential(appState.user.email, oldP);
        await appState.user.reauthenticateWithCredential(cred);
        await appState.user.updatePassword(newP);
        showToast("Password updated successfully!");
        document.getElementById("change-old-pw").value = '';
        document.getElementById("change-new-pw").value = '';
        document.getElementById("change-confirm-pw").value = '';
    } catch(err) { showToast(err.message, "error"); }
}

// ================= RAZORPAY =================
async function payNow() {
    if(!appState.user) return openAuthModal();
    showLoader();
    try {
        const doc = await db.collection("users").doc(appState.user.uid).get();
        const plan = doc.data().plan;
        
        const res = await api('/api/payments/create-order', 'POST', { plan });
        const orderData = res.data;

        const options = {
            key: "rzp_test_Sho7771I5NfLQD",
            amount: orderData.amount,
            currency: orderData.currency,
            name: "Max Health Club",
            description: `${plan} Membership Upgrade`,
            order_id: orderData.id,
            handler: async function (response) {
                try {
                    await api('/api/payments/verify', 'POST', {
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_signature: response.razorpay_signature
                    });
                    showToast("Payment successful!");
                    loadUserProfile();
                } catch (e) { showToast("Verification failed", "error"); }
            }
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
    } catch (err) {
        showToast(err.message, "error");
    } finally { hideLoader(); }
}
function choosePlan(planName) {
    if(!appState.user) {
        switchAuthView('signup');
        document.getElementById("plan-select").value = planName;
        openAuthModal();
    } else {
        if (appState.role === 'admin') return showToast("Admins do not need plans.", "error");
        db.collection("users").doc(appState.user.uid).update({ plan: planName, paymentStatus: "Unpaid" }).then(() => {
            loadUserProfile(); payNow();
        });
    }
}

// ================= EVENTS SYSTEM =================
async function loadEvents() {
    const errorState = document.getElementById("events-error-state");
    const container  = document.getElementById("eventsContainer");
    const emptyState = document.getElementById("events-empty-state");

    console.log("CONTAINER:", container);

    if (errorState) errorState.style.display = 'none';

    try {
        const result = await api('/api/events');
        console.log("RAW RESPONSE:", result);
        console.log("EVENT ARRAY:", result.data);

        const events = result.data;

        if (!events || events.length === 0) {
            container.innerHTML = "";
            if (emptyState) emptyState.style.display = "block";
            return;
        }

        if (emptyState) emptyState.style.display = "none";

        // NOTE: no 'reveal fade-up' — dynamically injected cards are never
        // observed by IntersectionObserver, so they stay invisible. Removed.
        container.innerHTML = events.map(ev => `
            <div class="event-card premium-card ${ev.isHoliday ? 'holiday' : ''}">
                <div class="event-date">${new Date(ev.date).toLocaleDateString(undefined, {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</div>
                <h3 style="font-size: 1.5rem; margin-bottom: 10px;">${ev.title} ${ev.isHoliday ? '🚫' : ''}</h3>
                <p style="color: var(--text-muted); font-size: 0.95rem;">${ev.description || ''}</p>
                ${ev.isHoliday ? '<span style="display:inline-block; margin-top:10px; background:rgba(251,191,36,0.2); color:#fbbf24; padding:3px 8px; border-radius:4px; font-size:0.8rem;">Holiday</span>' : ''}
            </div>
        `).join('');

        console.log("Events rendered:", events.length);
    } catch (e) {
        console.error("Failed to load events:", e);
        if (errorState) {
            errorState.style.display = 'block';
            errorState.innerHTML = `<p>Failed to load events</p><button class="btn btn-outline btn-sm" style="margin-top: 15px;" onclick="loadEvents()">Try Again</button>`;
        }
    }
}

// ================= REVIEWS SYSTEM =================
let currentReviewRating = 5;
document.querySelectorAll('#star-rating-input span').forEach(star => {
    star.addEventListener('click', (e) => {
        currentReviewRating = parseInt(e.target.dataset.value);
        document.querySelectorAll('#star-rating-input span').forEach(s => {
            s.classList.toggle('active', parseInt(s.dataset.value) <= currentReviewRating);
        });
    });
});

function openReviewForm() {
    if(!appState.user) return openAuthModal();
    if(appState.role === 'admin') return showToast("Admins cannot leave user reviews.", "error");
    document.getElementById("review-form-container").style.display = "block";
    document.getElementById("review-form-container").scrollIntoView({ behavior: 'smooth' });
}
function closeReviewForm() { document.getElementById("review-form-container").style.display = "none"; clearImagePreview(); }

function previewReviewImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('image-preview').src = e.target.result;
            document.getElementById('image-preview-container').style.display = 'inline-block';
        }
        reader.readAsDataURL(file);
    }
}
function clearImagePreview() {
    document.getElementById('review-image').value = "";
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('image-preview').src = "";
}

async function submitReview() {
    const text = document.getElementById("review-text").value;
    const file = document.getElementById("review-image").files[0];
    if(!text) return showToast("Review text is required", "error");

    showLoader();
    try {
        let imageUrl = null;
        if (file) {
            if(file.size > 2 * 1024 * 1024) throw new Error("Image must be less than 2MB");
            const storageRef = storage.ref(`reviews/${appState.user.uid}/${Date.now()}.jpg`);
            await storageRef.put(file);
            imageUrl = await storageRef.getDownloadURL();
        }

        const docSnap = await db.collection("users").doc(appState.user.uid).get();
        const name = docSnap.exists ? docSnap.data().name : "User";

        await api('/api/reviews', 'POST', { rating: currentReviewRating, text, imageUrl, name });
        showToast("Review submitted successfully!");
        closeReviewForm();
        
        // Fix: Immediately fetch and render the newly updated review list
        await loadReviews('newest');
    } catch (err) { showToast(err.message, "error"); } finally { hideLoader(); }
}

async function loadReviews(filter, clickedBtn) {
    // Fix: never touch window.event — use the explicitly passed button reference
    document.querySelectorAll('.filters .btn').forEach(b => b.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');

    const container  = document.getElementById("reviews-grid");
    const emptyState = document.getElementById("reviews-empty-state");

    if (!container) {
        console.error("Review container #reviews-grid not found");
        return;
    }

    try {
        const res = await api(`/api/reviews?filter=${filter}&limit=6`);
        console.log("RAW REVIEWS RESPONSE:", res);

        const reviews = res.data;
        console.log("REVIEWS ARRAY:", reviews);

        if (!reviews || reviews.length === 0) {
            container.innerHTML = "";
            if (emptyState) emptyState.style.display = "block";
            return;
        }

        if (emptyState) emptyState.style.display = "none";

        // NOTE: no 'reveal fade-up' — dynamically injected cards are never
        // observed by IntersectionObserver and stay opacity:0 forever
        container.innerHTML = reviews.map(r => `
            <div class="review-card premium-card">
                <div class="review-header">
                    <div>
                        <h4 style="margin-bottom: 5px; font-size: 1.2rem;">${r.name || 'Anonymous'}</h4>
                        <div class="review-stars">${'★'.repeat(r.rating || 0)}${'☆'.repeat(5 - (r.rating || 0))}</div>
                    </div>
                    <div class="review-date">${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}</div>
                </div>
                <p style="color: rgba(255,255,255,0.9);">${r.text || ''}</p>
                ${r.imageUrl ? `<img src="${r.imageUrl}" class="review-image" loading="lazy">` : ''}
                ${(appState.user && appState.user.uid === r.id) ? `<button class="btn btn-outline btn-sm" style="margin-top:20px; border-color:#ef4444; color:#ef4444;" onclick="deleteReview('${r.id}')">Delete My Review</button>` : ''}
            </div>
        `).join('');

        console.log("Reviews rendered:", reviews.length);
    } catch (e) {
        console.error("Failed to load reviews:", e);
    }
}

async function deleteReview(id) {
    if(!confirm("Are you sure you want to delete your review?")) return;
    try {
        await api(`/api/reviews/${id}`, 'DELETE');
        showToast("Review deleted");
        loadReviews('newest');
    } catch(err) { showToast("Failed to delete", "error"); }
}

// ================= ADMIN DASHBOARD LOGIC (OVERLAY) =================
function toggleAdminDashboard(forceState) {
    if (appState.role !== 'admin') return;
    const overlay = document.getElementById("admin-dashboard-overlay");
    
    if (typeof forceState === 'boolean') {
        appState.adminOverlayOpen = forceState;
    } else {
        appState.adminOverlayOpen = !appState.adminOverlayOpen;
    }

    if (appState.adminOverlayOpen) {
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        switchAdminTab('dashboard'); // Load data
    } else {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function switchAdminTab(tab) {
    if (appState.role !== 'admin') return;
    document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.admin-nav-btn').forEach(el => el.classList.remove('active'));
    
    const target = document.getElementById(`admin-tab-${tab}`);
    if(target) target.style.display = 'block';
    if(event && event.target) event.target.classList.add('active');

    if (tab === 'dashboard') loadAdminOverview();
    if (tab === 'customers') loadAdminCustomers();
    if (tab === 'events') loadAdminEvents();
}

async function loadAdminOverview() {
    try {
        const statsRes = await api('/api/admin/stats');
        document.getElementById('stat-users').innerText = statsRes.data.totalUsers;
        document.getElementById('stat-active-users').innerText = statsRes.data.activeUsers;
        document.getElementById('stat-events').innerText = statsRes.data.activeEvents;
    } catch(e) { console.error("Stats Error:", e); }
}

async function loadAdminCustomers() {
    const list = document.getElementById("user-list");
    const loader = document.getElementById("admin-customers-loader");
    const errorMsg = document.getElementById("admin-customers-error");
    
    list.innerHTML = "";
    loader.style.display = "block";
    errorMsg.style.display = "none";

    try {
        const res = await api('/api/users');
        loader.style.display = "none";
        list.innerHTML = res.data.map(u => `
            <tr>
                <td style="font-weight: 600;">${u.name}</td>
                <td style="color: var(--text-muted);">${u.email}</td>
                <td>${u.plan || 'N/A'}</td>
                <td><span class="status-badge ${u.paymentStatus==='Paid'?'paid':'pending'}">${u.paymentStatus}</span></td>
                <td>
                    ${u.role === 'admin' 
                        ? '<span style="color:var(--text-muted); font-size:0.8rem;">Admin</span>' 
                        : `<div style="display:flex; gap: 8px;">
                               ${u.paymentStatus !== 'Paid' ? `<button class="btn btn-outline btn-sm" onclick="markPaid('${u.id}')" style="border-color:#4ade80; color:#4ade80;">Mark Paid</button>` : ''}
                               <button class="btn btn-outline btn-sm" onclick="softDeleteUser('${u.id}')" style="border-color:#ef4444; color:#ef4444;">Remove</button>
                           </div>`
                    }
                </td>
            </tr>
        `).join('');
    } catch(e) { 
        loader.style.display = "none";
        errorMsg.style.display = "block";
        showToast("Error loading users: " + e.message, "error"); 
    }
}

async function markPaid(uid) {
    if(!confirm("Manually mark this user as paid?")) return;
    try {
        await api('/api/payments/mark-paid', 'POST', { userId: uid });
        showToast("User marked as paid");
        loadAdminCustomers();
        loadAdminOverview();
    } catch(e) { showToast(e.message, "error"); }
}

async function softDeleteUser(uid) {
    if(!confirm("Remove this user? (Soft delete)")) return;
    try {
        await api(`/api/users/${uid}`, 'DELETE');
        showToast("User removed");
        loadAdminCustomers();
        loadAdminOverview();
    } catch(e) { showToast(e.message, "error"); }
}

async function loadAdminEvents() {
    try {
        const res = await api('/api/events');
        const list = document.getElementById("admin-event-list");
        list.innerHTML = res.data.map(ev => `
            <tr>
                <td style="font-weight: bold;">${ev.title}</td>
                <td style="color: var(--text-muted);">${new Date(ev.date).toLocaleDateString()}</td>
                <td>${ev.isHoliday ? 'Holiday (Closed)' : 'Standard'}</td>
                <td><button class="btn btn-outline btn-sm" onclick="deleteEvent('${ev.id}')" style="border-color:#ef4444; color:#ef4444;">Remove</button></td>
            </tr>
        `).join('');
    } catch(e) { showToast("Error loading events", "error"); }
}

async function createGymEvent() {
    const title       = document.getElementById("admin-event-title").value.trim();
    const date        = document.getElementById("admin-event-date").value;
    const description = document.getElementById("admin-event-desc").value.trim();
    const isHoliday   = document.getElementById("admin-event-isholiday").checked;

    console.log({ title, description, date, isHoliday });

    if (!title || !date) return showToast("Title and date required", "error");

    const btn = document.querySelector('[onclick="createGymEvent()"]');
    if (btn) { btn.disabled = true; btn.innerText = "Publishing..."; }

    try {
        await api('/api/events', 'POST', { title, date, description, isHoliday });
        showToast("Event created");

        document.getElementById("admin-event-title").value = '';
        document.getElementById("admin-event-date").value = '';
        document.getElementById("admin-event-desc").value = '';
        document.getElementById("admin-event-isholiday").checked = false;

        loadAdminEvents();
        loadEvents();
        loadAdminOverview();
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Publish Event"; }
    }
}

async function deleteEvent(id) {
    if(!confirm("Delete event?")) return;
    try { 
        await api(`/api/events/${id}`, 'DELETE'); 
        loadAdminEvents(); 
        loadEvents();
        loadAdminOverview();
        showToast("Event deleted"); 
    } catch(e) {}
}

// ================= ANIMATIONS & SCROLL =================
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
});

// Intersection Observer for Reveal
const observerOptions = { threshold: 0.1, rootMargin: "0px 0px -50px 0px" };
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && !appState.reduceMotion) {
            entry.target.classList.add('active');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

function initAnimations() {
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// BULLETPROOF GYM PLATE TRACKER (No Infinite Stacking, No Overflow)
let previousPlateCount = 0;

function updatePlates() {
    if (appState.reduceMotion || window.innerWidth < 768) return;
    
    const container = document.getElementById('plates-container');
    if (!container) return;

    // Calculate Scroll Percentage
    const scrollHeight = document.body.scrollHeight - window.innerHeight;
    const scrollPercent = Math.max(0, Math.min(1, window.scrollY / scrollHeight));
    
    // Map strictly to 0 - 10 plates
    const targetPlates = Math.floor(scrollPercent * 10);

    // Only manipulate DOM if count changed to prevent thrashing
    if (targetPlates !== previousPlateCount) {
        // Hard clear container to prevent infinite stacking or overflow bugs
        container.innerHTML = '';
        
        // Re-render based entirely on current percentage
        for (let i = 1; i <= targetPlates; i++) {
            const plate = document.createElement('div');
            plate.className = `gym-plate ${i % 3 === 0 ? 'red' : ''}`;
            plate.innerText = i % 3 === 0 ? '25KG' : '10KG';
            container.appendChild(plate);
            
            // Force reflow and apply active class for CSS transition to trigger
            void plate.offsetWidth;
            plate.classList.add('active');
        }
        previousPlateCount = targetPlates;
    }
}

window.addEventListener('scroll', () => {
    if (!appState.reduceMotion) {
        window.requestAnimationFrame(updatePlates);
    }
});

// Reduce Motion Toggle
function toggleReduceMotion() {
    appState.reduceMotion = document.getElementById("reduce-motion-toggle").checked;
    if (appState.reduceMotion) {
        document.body.classList.add('reduce-motion');
        document.querySelectorAll('.reveal').forEach(el => el.classList.add('active'));
    } else {
        document.body.classList.remove('reduce-motion');
    }
}

// ================= INITIALIZATION =================
window.addEventListener('DOMContentLoaded', () => {
    // Parallax Hero
    window.addEventListener('scroll', () => {
        if(!appState.reduceMotion) {
            const hero = document.querySelector('.hero');
            if(hero) hero.style.backgroundPositionY = `${window.scrollY * 0.4}px`;
        }
    });

    // ── Hamburger menu toggle ──────────────────────────────────────────────
    const menuToggle = document.getElementById('mobile-menu');
    const navLinks   = document.getElementById('main-nav-links');

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('active');
            menuToggle.classList.toggle('active', isOpen);
            menuToggle.setAttribute('aria-expanded', isOpen);
        });

        // Close menu when any nav link is clicked
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                menuToggle.classList.remove('active');
                menuToggle.setAttribute('aria-expanded', 'false');
            });
        });

        // Close menu on outside click
        document.addEventListener('click', (e) => {
            if (!menuToggle.contains(e.target) && !navLinks.contains(e.target)) {
                navLinks.classList.remove('active');
                menuToggle.classList.remove('active');
                menuToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }
    // ──────────────────────────────────────────────────────────────────────

    initAnimations();
    loadEvents();
    loadReviews('newest');
});