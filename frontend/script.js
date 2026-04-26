// Body display none removed
// ================= NAVBAR =================
const API_BASE_URL = 'http://localhost:3000';
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
    if (window.scrollY > 50) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
});

// ================= MOBILE MENU =================
const menuToggle = document.getElementById('mobile-menu');
const navLinks = document.querySelector('.nav-links');
const navItems = document.querySelectorAll('.nav-links li a');

menuToggle?.addEventListener('click', () => {
    menuToggle.classList.toggle('active');
    navLinks.classList.toggle('active');
});

navItems.forEach(item => {
    item.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        navLinks.classList.remove('active');
    });
});

// ================= CONTACT FORM =================
const contactForm = document.getElementById('contact-form');
const formStatus = document.getElementById('form-status');

if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const message = document.getElementById('message').value;

        if (name && email && message) {
            const btn = contactForm.querySelector('button');
            const original = btn.textContent;

            btn.textContent = "Sending...";
            btn.disabled = true;

            setTimeout(() => {
                contactForm.reset();
                btn.textContent = original;
                btn.disabled = false;

                formStatus.textContent = "Message sent!";
                formStatus.classList.add('success');

                setTimeout(() => {
                    formStatus.textContent = "";
                    formStatus.classList.remove('success');
                }, 3000);

            }, 1500);
        }
    });
}

// ================= FIREBASE =================
const firebaseConfig = {
    apiKey: "AIzaSyCykaC3C4w3i9IeEFUw4Rj4lJWrfS6rUU0",
    authDomain: "gym-management-a2ea0.firebaseapp.com",
    projectId: "gym-management-a2ea0",
    storageBucket: "gym-management-a2ea0.firebasestorage.app",
    messagingSenderId: "807411949129",
    appId: "1:807411949129:web:5dc2e9bcde801c4831a998"

};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

const ADMIN_EMAIL = "suzainboss327@gmail.com";

// Removed Google Script URL

// ================= UI UTILITIES =================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

let isLoginMode = true;
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const btn = document.getElementById('auth-primary-btn');
    const toggleText = document.getElementById('auth-toggle-text');
    const signupFields = document.getElementById('signup-fields');

    if (isLoginMode) {
        title.innerText = "Login";
        subtitle.innerText = "Welcome back to Max Health Club Gym";
        btn.innerText = "Sign In";
        btn.onclick = login;
        signupFields.style.display = "none";
        toggleText.innerHTML = `Don't have an account? <span onclick="toggleAuthMode()">Sign up here</span>`;
    } else {
        title.innerText = "Sign Up";
        subtitle.innerText = "Start your transformation today";
        btn.innerText = "Create Account";
        btn.onclick = signup;
        signupFields.style.display = "block";
        toggleText.innerHTML = `Already have an account? <span onclick="toggleAuthMode()">Login here</span>`;
    }
}

function switchAdminTab(tabId, element) {
    // Update active tab in sidebar
    document.getElementById('admin-section').querySelectorAll('.sidebar-nav li').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    // Switch content
    document.getElementById('admin-section').querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('admin-tab-' + tabId).classList.add('active');

    if (tabId === 'customers') {
        loadAllUsers();
    }
}

function switchUserTab(tabId, element) {
    // Update active tab in sidebar
    document.getElementById('user-section').querySelectorAll('.sidebar-nav li').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    // Switch content
    document.getElementById('user-section').querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('user-tab-' + tabId).classList.add('active');
}

// ================= SIGNUP =================
function signup() {
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;
    const name = document.getElementById("fullname").value;
    const contact = document.getElementById("contact").value;
    const address = document.getElementById("address").value;
    const plan = document.getElementById("plan-select").value;

    if (!email || !password || !name || !contact || !address || !plan) {
        return showToast("Please fill all fields", "error");
    }
    if (!/^\d{10}$/.test(contact)) {
        return showToast("Please enter a valid 10-digit phone number", "error");
    }

    const btn = document.getElementById('auth-primary-btn');
    const originalText = btn.innerText;
    btn.innerText = "Creating...";
    btn.disabled = true;

    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            const user = userCredential.user;
            const userData = {
                uid: user.uid,
                name: name,
                email: email,
                contact: contact,
                address: address,
                plan: plan,
                paymentStatus: "Unpaid",
                joinDate: new Date().toLocaleDateString()
            };

            // Backend sync
            return fetch(`${API_BASE_URL}/api/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userData)
            }).then(res => {
                if (!res.ok) throw new Error("Backend sync failed");
                return res.json();
            });
        })
        .then(() => {
            showToast("Account created successfully!");
        })
        .catch(err => {
            console.error(err);
            showToast(err.message, "error");
        })
        .finally(() => {
            btn.innerText = originalText;
            btn.disabled = false;
        });
}

// ================= LOGIN =================
function login() {
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;

    if (!email || !password) {
        return showToast("Please fill all fields", "error");
    }

    const btn = document.getElementById('auth-primary-btn');
    const originalText = btn.innerText;
    btn.innerText = "Signing in...";
    btn.disabled = true;

    auth.signInWithEmailAndPassword(email, password)
        .catch(err => {
            let errorMsg = "Login failed. Please try again.";
            if (err.code === 'auth/user-not-found') {
                errorMsg = "Username is incorrect";
            } else if (err.code === 'auth/wrong-password') {
                errorMsg = "Password is incorrect";
            } else if (err.code === 'auth/invalid-credential') {
                errorMsg = "Username & Password are incorrect. Please sign up";
            }
            showToast(errorMsg, "error");
            btn.innerText = originalText;
            btn.disabled = false;
        });
}

// ================= GOOGLE LOGIN =================
function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            const user = result.user;
            // Check if user exists in Firestore
            db.collection("users").doc(user.uid).get().then(doc => {
                if (!doc.exists) {
                    // New user from Google, need additional details
                    isLoginMode = false;
                    const title = document.getElementById('auth-title');
                    const subtitle = document.getElementById('auth-subtitle');
                    const btn = document.getElementById('auth-primary-btn');
                    const signupFields = document.getElementById('signup-fields');
                    const emailInput = document.getElementById("auth-email");
                    const passwordInput = document.getElementById("auth-password");

                    title.innerText = "Complete Profile";
                    subtitle.innerText = "Please provide additional details";
                    signupFields.style.display = "block";

                    emailInput.value = user.email;
                    emailInput.disabled = true;
                    passwordInput.style.display = "none"; // Hide password for Google users

                    btn.innerText = "Save & Continue";
                    btn.onclick = () => {
                        const name = document.getElementById("fullname").value || user.displayName;
                        const contact = document.getElementById("contact").value;
                        const address = document.getElementById("address").value;
                        const plan = document.getElementById("plan-select").value;

                        if (!name || !contact || !address || !plan) {
                            return showToast("Please fill all fields", "error");
                        }

                        const userData = {
                            uid: user.uid,
                            name: name,
                            email: user.email,
                            contact: contact,
                            address: address,
                            plan: plan,
                            paymentStatus: "Unpaid",
                            joinDate: new Date().toLocaleDateString()
                        };

                        fetch(`${API_BASE_URL}/api/signup`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(userData)
                        }).then(res => {
                            if (!res.ok) throw new Error("Backend sync failed");
                            showToast("Profile completed successfully!");
                            document.getElementById("auth-overlay").classList.remove("show");
                            document.getElementById("home").style.display = "none";
                            document.getElementById("user-section").classList.add("active");
                            loadUserData(user.uid);
                        }).catch(err => {
                            showToast("Failed to save profile", "error");
                        });
                    };
                } else {
                    // Existing user
                    showToast("Logged in successfully");
                }
            });
        })
        .catch((error) => {
            showToast(error.message, "error");
        });
}

// ================= LOGOUT =================
function logout() {
    auth.signOut().then(() => {
        showToast("Logged out successfully");
    });
}

// ================= USER DASHBOARD =================
function loadUserData(uid) {
    db.collection("users").doc(uid).get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();

                document.getElementById("user-name").innerText = data.name || "User";
                if (document.getElementById("user-email")) document.getElementById("user-email").innerText = data.email || "";
                if (document.getElementById("user-join-date")) document.getElementById("user-join-date").innerText = data.joinDate || "-";

                let lastPaidDateText = "-";
                let daysRemaining = 0;
                let isPaid = (data.paymentStatus === 'Paid' || data.payment === 'Paid');

                if (data.lastPaymentDate) {
                    const lastPaid = new Date(data.lastPaymentDate);
                    lastPaidDateText = lastPaid.toLocaleDateString();

                    const today = new Date();
                    const diffTime = Math.abs(today - lastPaid);
                    const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    if (daysPassed >= 30) {
                        isPaid = false;
                        daysRemaining = 0;
                    } else {
                        daysRemaining = 30 - daysPassed;
                    }
                }

                if (document.getElementById("user-last-paid")) document.getElementById("user-last-paid").innerText = lastPaidDateText;

                const planSpan = document.getElementById("user-plan");
                planSpan.innerText = data.plan;

                const statusSpan = document.getElementById("user-payment");
                statusSpan.innerText = isPaid ? "Paid" : "Unpaid";

                // Styling badges
                statusSpan.className = "value status-badge " + (isPaid ? 'paid' : 'pending');

                // Show/hide Pay Now button
                const payNowBtn = document.getElementById("pay-now-btn");
                if (payNowBtn) {
                    payNowBtn.style.display = isPaid ? "none" : "block";
                }

                // Progress Bar Logic
                if (data.lastPaymentDate) {
                    const progressPercentage = Math.min(((30 - daysRemaining) / 30) * 100, 100);

                    const daysEl = document.getElementById("days-remaining");
                    if (daysEl) daysEl.innerText = `${daysRemaining} days remaining`;

                    const progressBar = document.getElementById("cycle-progress");
                    if (progressBar) {
                        progressBar.style.width = `${progressPercentage}%`;

                        // Color transitions
                        if (daysRemaining <= 3) {
                            progressBar.style.background = "#ef4444"; // Red
                        } else if (daysRemaining <= 10) {
                            progressBar.style.background = "#fbbf24"; // Yellow
                        } else {
                            progressBar.style.background = "#4ade80"; // Green
                        }
                    }
                }
            }
        });
}

// ================= ADMIN PANEL =================
// Global variable to store users for filtering
let allCustomersData = [];

function loadAllUsers() {
    const userList = document.getElementById("user-list");
    const loading = document.getElementById("admin-loading");

    userList.innerHTML = "";
    loading.style.display = "block";

    db.collection("users").get().then(snapshot => {
        loading.style.display = "none";

        allCustomersData = [];
        let activePlans = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            allCustomersData.push(data);
            if (data.paymentStatus === 'Paid' || data.payment === 'Paid') activePlans++;
        });

        document.getElementById("stat-total-users").innerText = snapshot.size;
        document.getElementById("stat-active-plans").innerText = activePlans;

        renderCustomerTable(allCustomersData);
    }).catch(err => {
        loading.style.display = "none";
        showToast("Error loading users", "error");
    });
}

function renderCustomerTable(dataList) {
    const userList = document.getElementById("user-list");
    userList.innerHTML = "";
    dataList.forEach(data => {
        const isPaid = (data.paymentStatus === 'Paid' || data.payment === 'Paid');
        const statusClass = isPaid ? 'paid' : 'pending';
        const actionBtn = isPaid
            ? `<span style="color: #4ade80; font-weight:bold;">✔ Paid</span>`
            : `<button class="btn btn-outline btn-sm" onclick="markPaid('${data.id}')">Mark Paid</button>`;

        // Format dates
        const joinDate = data.joinDate || '-';
        const lastPaid = data.lastPaymentDate ? new Date(data.lastPaymentDate).toLocaleDateString() : '-';

        userList.innerHTML += `
            <tr>
                <td>${data.name || 'User'}</td>
                <td>${data.contact || '-'}</td>
                <td>${data.plan || 'Basic'}</td>
                <td>${joinDate}</td>
                <td>${lastPaid}</td>
                <td><span class="status-badge ${statusClass}">${data.paymentStatus || data.payment || "Unpaid"}</span></td>
                <td>${actionBtn}</td>
            </tr>
        `;
    });
}

// Attach event listeners for search and filter
document.getElementById('search-customer')?.addEventListener('input', () => applyCustomerFilters());
document.getElementById('filter-customer')?.addEventListener('change', () => applyCustomerFilters());

function applyCustomerFilters() {
    const searchEl = document.getElementById('search-customer');
    const filterEl = document.getElementById('filter-customer');
    if (!searchEl || !filterEl) return;

    const searchTerm = searchEl.value.toLowerCase();
    const filterVal = filterEl.value;

    let filtered = allCustomersData.filter(user => {
        return (user.name || '').toLowerCase().includes(searchTerm);
    });

    if (filterVal === 'paid') {
        filtered = filtered.filter(u => u.paymentStatus === 'Paid' || u.payment === 'Paid');
    } else if (filterVal === 'unpaid') {
        filtered = filtered.filter(u => u.paymentStatus === 'Unpaid' || u.payment === 'Unpaid' || u.paymentStatus === 'Pending' || u.payment === 'Pending');
    } else if (filterVal === 'sort-name') {
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    renderCustomerTable(filtered);
}

// ================= MARK PAYMENT =================
function markPaid(userId) {
    showToast("Updating payment...", "success");
    const btn = event?.target;
    if (btn) btn.disabled = true;

    fetch(`${API_BASE_URL}/api/payments/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("Payment marked as Paid!");
                loadAllUsers(); // Refresh the list
            } else {
                throw new Error(data.error || "Failed to update payment");
            }
        })
        .catch(err => {
            console.error(err);
            showToast("Failed to update payment", "error");
            if (btn) btn.disabled = false;
        });
}

// ================= RAZORPAY INTEGRATION =================
function payNow() {
    const user = auth.currentUser;
    if (!user) return showToast("Please login first", "error");

    showToast("Initializing payment...", "success");

    // Fetch user details to get the plan amount
    db.collection("users").doc(user.uid).get().then(doc => {
        if (!doc.exists) return showToast("User not found", "error");

        const data = doc.data();
        let amount = 999; // Default Basic
        if (data.plan === "Standard") amount = 1999;
        if (data.plan === "Premium") amount = 2999;

        // 1. Create order on backend
        fetch(`${API_BASE_URL}/api/payments/create-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amount, plan: data.plan })
        })
            .then(res => res.json())
            .then(orderData => {
                if (!orderData.success) throw new Error("Failed to create order");

                // 2. Open Razorpay Checkout
                const options = {
                    key: "rzp_test_Sho7771I5NfLQD", // ✅ REAL KEY
                    amount: orderData.order.amount,
                    currency: orderData.order.currency,
                    name: "Max Health Club Gym",
                    description: `${data.plan} Membership`,
                    order_id: orderData.order.id,

                    handler: function (response) {
                        console.log("Payment success:", response);

                        fetch(`${API_BASE_URL}/api/payments/verify`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_signature: response.razorpay_signature,
                                userId: user.uid
                            })
                        })
                            .then(res => res.json())
                            .then(verifyData => {
                                if (verifyData.success) {
                                    showToast("Payment successful!");
                                    loadUserData(user.uid);
                                } else {
                                    showToast("Verification failed", "error");
                                }
                            })
                            .catch(() => showToast("Verification error", "error"));
                    }
                };

                const rzp = new window.Razorpay(options);
                rzp.on('payment.failed', function (response) {
                    showToast(response.error.description || "Payment failed", "error");
                });
                rzp.open();
            })
            .catch(err => {
                console.error(err);
                showToast("Error initializing payment", "error");
            });
    });
}

// ================= UI STATE MANAGEMENT =================
function updateUIState(user) {
    const overlay = document.getElementById("auth-overlay");
    const landing = document.getElementById("landing-section");
    const adminSec = document.getElementById("admin-section");
    const userSec = document.getElementById("user-section");

    if (user) {
        if (user.email === ADMIN_EMAIL) {
            if (overlay) overlay.classList.remove("show");
            if (landing) landing.style.display = "none";
            if (adminSec) adminSec.classList.add("active");
            if (userSec) userSec.classList.remove("active");

            // Load admin stats
            db.collection("users").get().then(snap => {
                const totalEl = document.getElementById("stat-total-users");
                const activeEl = document.getElementById("stat-active-plans");
                if (totalEl) totalEl.innerText = snap.size;
                let active = 0;
                snap.forEach(d => { if (d.data().paymentStatus === 'Paid' || d.data().payment === 'Paid') active++; });
                if (activeEl) activeEl.innerText = active;
            });
        } else {
            // Check if user has complete profile in Firestore
            db.collection("users").doc(user.uid).get().then(doc => {
                if (doc.exists) {
                    if (overlay) overlay.classList.remove("show");
                    if (landing) landing.style.display = "none";
                    if (userSec) userSec.classList.add("active");
                    if (adminSec) adminSec.classList.remove("active");
                    loadUserData(user.uid);
                } else {
                    // Profile incomplete (e.g. new Google login)
                    // Keep overlay open so signInWithGoogle can show Complete Profile form
                    if (overlay) overlay.classList.add("show");
                    if (landing) landing.style.display = "block";
                }
            });
        }

        // Reset login button text if it was loading
        const btn = document.getElementById('auth-primary-btn');
        if (btn) {
            btn.innerText = isLoginMode ? "Sign In" : "Create Account";
            btn.disabled = false;
        }
    } else {
        if (landing) landing.style.display = "block";
        if (adminSec) adminSec.classList.remove("active");
        if (userSec) userSec.classList.remove("active");

        // Hide overlay until triggered
        if (overlay) overlay.classList.remove("show");

        // Clear inputs
        const emailInput = document.getElementById("auth-email");
        const passInput = document.getElementById("auth-password");
        if (emailInput) emailInput.value = "";
        if (passInput) passInput.value = "";
    }
}

// ================= AUTH STATE =================
auth.onAuthStateChanged(user => {
    console.log("Auth state changed, user:", user ? user.email : "none");
    updateUIState(user);
});

function openAuthOrDashboard() {
    console.log("openAuthOrDashboard called");
    const user = auth.currentUser;
    if (user) {
        // If already logged in, just update UI
        updateUIState(user);
    } else {
        // Show auth overlay
        document.getElementById("auth-overlay").classList.add("show");
    }
}

function choosePlan(planName, amount) {
    console.log(`choosePlan called for ${planName} at ${amount}`);
    const user = auth.currentUser;
    if (!user) {
        showToast("Please login or sign up to select a plan", "info");
        // Open sign up mode pre-filled with plan
        isLoginMode = false;
        const title = document.getElementById('auth-title');
        const subtitle = document.getElementById('auth-subtitle');
        const btn = document.getElementById('auth-primary-btn');
        const toggleText = document.getElementById('auth-toggle-text');
        const signupFields = document.getElementById('signup-fields');

        title.innerText = "Sign Up";
        subtitle.innerText = "Start your transformation today";
        btn.innerText = "Create Account";
        btn.onclick = signup;
        signupFields.style.display = "block";
        toggleText.innerHTML = `Already have an account? <span onclick="toggleAuthMode()">Login here</span>`;

        document.getElementById("plan-select").value = planName;
        document.getElementById("auth-overlay").classList.add("show");
    } else {
        // Update user plan and redirect to payment
        showToast(`Updating plan to ${planName}...`, "success");
        db.collection("users").doc(user.uid).update({
            plan: planName,
            paymentStatus: "Unpaid"
        }).then(() => {
            loadUserData(user.uid);
            setTimeout(() => {
                payNow();
            }, 1000);
        });
    }
}

// ================= THREE.JS 3D DUMBBELL =================
function init3D() {
    const container = document.getElementById('canvas-container');
    if (!container || !window.THREE) return;

    const scene = new THREE.Scene();
    // Use an orthographic-like narrow perspective for a flatter isometric look
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const dumbbell = new THREE.Group();

    // Materials
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
    const weightMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.3, roughness: 0.7 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xe60000, metalness: 0.5, roughness: 0.5 });

    // Handle
    const handleGeo = new THREE.CylinderGeometry(0.2, 0.2, 4, 32);
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.rotation.z = Math.PI / 2;
    dumbbell.add(handle);

    // Weights (Left)
    const weightGeo1 = new THREE.CylinderGeometry(1.2, 1.2, 0.5, 32);
    const weightL1 = new THREE.Mesh(weightGeo1, weightMat);
    weightL1.rotation.z = Math.PI / 2;
    weightL1.position.x = -1.5;
    dumbbell.add(weightL1);

    const weightGeo2 = new THREE.CylinderGeometry(0.9, 0.9, 0.4, 32);
    const weightL2 = new THREE.Mesh(weightGeo2, accentMat);
    weightL2.rotation.z = Math.PI / 2;
    weightL2.position.x = -2.0;
    dumbbell.add(weightL2);

    // Weights (Right)
    const weightR1 = new THREE.Mesh(weightGeo1, weightMat);
    weightR1.rotation.z = Math.PI / 2;
    weightR1.position.x = 1.5;
    dumbbell.add(weightR1);

    const weightR2 = new THREE.Mesh(weightGeo2, accentMat);
    weightR2.rotation.z = Math.PI / 2;
    weightR2.position.x = 2.0;
    dumbbell.add(weightR2);

    scene.add(dumbbell);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    camera.position.z = 10;
    camera.position.y = 2;
    camera.position.x = -5;
    camera.lookAt(0, 0, 0);

    // Initial rotation
    dumbbell.rotation.x = Math.PI / 6;

    // Animation loop
    const animate = function () {
        requestAnimationFrame(animate);
        dumbbell.rotation.y += 0.005;
        renderer.render(scene, camera);
    };

    animate();

    // Resize handler
    window.addEventListener('resize', () => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
}

// Initialize when window loads
window.addEventListener('load', init3D);