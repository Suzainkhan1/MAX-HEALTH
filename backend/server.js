require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const cron = require('node-cron');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const path = require('path');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const NodeCache = require('node-cache');

// --- Optional: Twilio (only if env vars present) ---
let twilio;
try { twilio = require('twilio'); } catch (_) {}

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const cache = new NodeCache({ stdTTL: 600 });

// =============================================================
// FIREBASE INITIALIZATION — uses serviceAccountKey.json directly
// =============================================================
let db = null;

try {
  if (!admin.apps.length) {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin Initialized');
  }
  db = admin.firestore();
} catch (error) {
  console.error('❌ Firebase Init Error:', error.message);
  console.warn('⚠️  Server will start but DB-dependent routes will return 503.');
}

// =============================================================
// OPTIONAL SERVICES
// =============================================================

// Twilio (optional)
let twilioClient = null;
if (twilio && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio initialized');
}

// Razorpay (optional)
let razorpayInstance = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  console.log('✅ Razorpay initialized');
}

// Nodemailer (falls back to mock if env missing)
let transporter;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  console.log('✅ Nodemailer initialized');
} else {
  transporter = {
    sendMail: async (opts) =>
      console.log(`[MOCK EMAIL] To: ${opts.to} | Subject: ${opts.subject}`),
  };
  console.warn('⚠️  Email credentials not set — using mock mailer');
}

// =============================================================
// MIDDLEWARE HELPERS
// =============================================================

const loginLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 5,  message: { success: false, error: 'Too many login attempts' } });
const otpLimiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: 3,  message: { success: false, error: 'Too many OTP requests' } });
const analyticsLimiter = rateLimit({ windowMs: 60 * 1000,    max: 10, message: { success: false, error: 'Analytics rate limited' } });

// DB guard — returns 503 if Firebase failed to init
const requireDb = (req, res, next) => {
  if (!db) return res.status(503).json({ success: false, error: 'Database not available' });
  next();
};

// Firebase Auth guard
const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Admin email fallback — matches frontend ADMIN_EMAIL constant
const ADMIN_EMAIL = 'suzainboss327@gmail.com';

// Admin guard — allows role === "admin" in Firestore OR email fallback
const verifyAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log('[verifyAdmin] Checking admin for:', decoded.email);

    // Fast-path: trust the admin email from the decoded Firebase token (no DB needed)
    if (decoded.email === ADMIN_EMAIL) {
      console.log('[verifyAdmin] Granted via email fallback');
      req.user = decoded;

      // Opportunistically ensure Firestore role is set (fire-and-forget)
      if (db) {
        db.collection('users').doc(decoded.uid).set({ role: 'admin' }, { merge: true }).catch(() => {});
      }
      return next();
    }

    // Standard path: check Firestore role
    if (!db) return res.status(503).json({ success: false, error: 'Database not available' });
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
      console.warn('[verifyAdmin] Denied for:', decoded.email);
      return res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
    }

    console.log('[verifyAdmin] Granted via Firestore role');
    req.user = decoded;
    next();
  } catch (err) {
    console.error('[verifyAdmin] Error:', err.message);
    res.status(401).json({ success: false, error: 'Invalid token or forbidden' });
  }
};

// Validation helper
const validate = (validations) => async (req, res, next) => {
  for (const v of validations) await v.run(req);
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  res.status(400).json({ success: false, error: errors.array()[0].msg });
};

// =============================================================
// STATIC FRONTEND
// =============================================================
app.use(express.static(path.join(__dirname, '../frontend')));

// =============================================================
// ROUTES: AUTH / SIGNUP
// =============================================================

app.post('/api/signup', requireDb, async (req, res, next) => {
  try {
    const { uid, name, email, contact, address, plan, joinDate, paymentStatus } = req.body;
    if (!uid || !email) return res.status(400).json({ success: false, error: 'uid and email are required' });

    const userData = {
      uid, name, email, contact, address, plan, joinDate, paymentStatus,
      lastPaymentDate: new Date().toISOString(),
      role: 'user',
      isDeleted: false,
    };
    await db.collection('users').doc(uid).set(userData);
    res.status(200).json({ success: true, data: userData });
  } catch (error) { next(error); }
});

app.post(
  '/api/auth/forgot-password/send-otp',
  otpLimiter,
  requireDb,
  validate([body('email').isEmail()]),
  async (req, res, next) => {
    try {
      const { email } = req.body;
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000;

      await db.collection('otps').doc(email).set({ email, otp, expiresAt, attempts: 0, used: false });
      await transporter.sendMail({
        from: process.env.EMAIL_USER || 'no-reply@maxhealth.com',
        to: email,
        subject: 'Password Reset OTP',
        text: `Your OTP for Max Health Gym is: ${otp}. It expires in 10 minutes.`,
      });
      res.status(200).json({ success: true, message: 'OTP sent' });
    } catch (error) { next(error); }
  }
);

app.post(
  '/api/auth/forgot-password/verify-otp',
  otpLimiter,
  requireDb,
  validate([body('email').isEmail(), body('otp').isLength({ min: 6, max: 6 })]),
  async (req, res, next) => {
    try {
      const { email, otp } = req.body;
      const docRef = db.collection('otps').doc(email);
      const doc = await docRef.get();

      if (!doc.exists) return res.status(400).json({ success: false, error: 'OTP not found' });
      const data = doc.data();

      if (data.used)            return res.status(400).json({ success: false, error: 'OTP already used' });
      if (Date.now() > data.expiresAt) return res.status(400).json({ success: false, error: 'OTP expired' });
      if (data.attempts >= 3)   return res.status(400).json({ success: false, error: 'Too many attempts' });

      if (data.otp !== otp) {
        await docRef.update({ attempts: data.attempts + 1 });
        return res.status(400).json({ success: false, error: 'Invalid OTP' });
      }

      await docRef.update({ used: true });
      res.status(200).json({ success: true, message: 'OTP verified' });
    } catch (error) { next(error); }
  }
);

app.post(
  '/api/auth/forgot-password/reset',
  requireDb,
  validate([body('email').isEmail(), body('password').isLength({ min: 6 })]),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const doc = await db.collection('otps').doc(email).get();
      if (!doc.exists || !doc.data().used) {
        return res.status(400).json({ success: false, error: 'OTP not verified' });
      }
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(user.uid, { password });
      await db.collection('otps').doc(email).delete();
      res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (error) { next(error); }
  }
);

// =============================================================
// ROUTES: EVENTS
// =============================================================

app.get('/api/events', requireDb, async (req, res, next) => {
  try {
    const cached = cache.get('events');
    if (cached) return res.status(200).json({ success: true, data: cached });

    const snapshot = await db
      .collection('events')
      .where('isActive', '==', true)
      .where('isDeleted', '==', false)
      .orderBy('date', 'asc')
      .get();
    const events = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    cache.set('events', events);
    res.status(200).json({ success: true, data: events });
  } catch (error) { next(error); }
});

app.post('/api/events', verifyAdmin, requireDb, async (req, res) => {
  console.log('BODY:', req.body);

  const { title, date, description, isHoliday } = req.body;

  // Validate required fields
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ success: false, error: 'title is required' });
  }
  if (!date || typeof date !== 'string' || !date.trim()) {
    return res.status(400).json({ success: false, error: 'date is required' });
  }

  const newEvent = {
    title:       title.trim(),
    date:        date.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    isHoliday:   isHoliday === true || isHoliday === 'true',
    isActive:    true,
    isDeleted:   false,
    createdAt:   new Date().toISOString(),
  };

  console.log('Creating event:', newEvent);

  try {
    const ref = await db.collection('events').add(newEvent);
    cache.del('events');
    console.log('Event saved with id:', ref.id);
    return res.status(201).json({ success: true, id: ref.id });
  } catch (error) {
    console.error('Firestore write failed:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/events/:id', verifyAdmin, requireDb, async (req, res, next) => {
  try {
    await db.collection('events').doc(req.params.id).update({
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    });
    cache.del('events');
    res.status(200).json({ success: true, message: 'Event deleted' });
  } catch (error) { next(error); }
});

// =============================================================
// ROUTES: REVIEWS
// =============================================================

app.get('/api/reviews', requireDb, async (req, res, next) => {
  try {
    const { filter = 'newest', limit = 10, lastVisible } = req.query;
    const cacheKey = `reviews_${filter}_${limit}`;

    if (!lastVisible && cache.get(cacheKey)) {
      return res.status(200).json({ success: true, data: cache.get(cacheKey) });
    }

    let query = db.collection('reviews').where('isDeleted', '==', false);
    if (filter === '5star')    query = query.where('rating', '==', 5);
    if (filter === 'critical') query = query.where('rating', '<=', 3);

    const orderField = filter === 'most_relevant' ? 'rating' : 'createdAt';
    query = query.orderBy(orderField, 'desc').limit(parseInt(limit));

    if (lastVisible) {
      const docSnap = await db.collection('reviews').doc(lastVisible).get();
      if (docSnap.exists) query = query.startAfter(docSnap);
    }

    const snapshot = await query.get();
    const reviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (!lastVisible) cache.set(cacheKey, reviews);
    res.status(200).json({ success: true, data: reviews });
  } catch (error) { next(error); }
});

app.post(
  '/api/reviews',
  verifyAuth,
  requireDb,
  validate([body('rating').isInt({ min: 1, max: 5 }), body('text').notEmpty()]),
  async (req, res, next) => {
    try {
      const { rating, text, imageUrl, name } = req.body;
      const reviewData = {
        userId: req.user.uid, name, rating, text, imageUrl,
        createdAt: new Date().toISOString(),
        isDeleted: false,
      };
      await db.collection('reviews').doc(req.user.uid).set(reviewData);
      cache.flushAll();
      res.status(201).json({ success: true, data: reviewData });
    } catch (error) { next(error); }
  }
);

app.delete('/api/reviews/:id', verifyAuth, requireDb, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (req.user.uid !== id) {
      const userDoc = await db.collection('users').doc(req.user.uid).get();
      if (userDoc.data()?.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }
    }
    await db.collection('reviews').doc(id).update({
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    });
    cache.flushAll();
    res.status(200).json({ success: true, message: 'Review deleted' });
  } catch (error) { next(error); }
});

// =============================================================
// ROUTES: USERS (Admin)
// =============================================================

app.get('/api/users', verifyAdmin, requireDb, async (req, res, next) => {
  try {
    const snapshot = await db.collection('users').where('isDeleted', '==', false).get();
    const users = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ success: true, data: users });
  } catch (error) { next(error); }
});

app.delete('/api/users/:uid', verifyAdmin, requireDb, async (req, res, next) => {
  try {
    await db.collection('users').doc(req.params.uid).update({
      isDeleted: true, status: 'inactive',
      deletedAt: new Date().toISOString(),
    });
    res.status(200).json({ success: true, message: 'User soft deleted' });
  } catch (error) { next(error); }
});

// =============================================================
// ROUTES: PAYMENTS
// =============================================================

app.post('/api/payments/create-order', verifyAuth, requireDb, async (req, res, next) => {
  try {
    if (!razorpayInstance) {
      return res.status(503).json({ success: false, error: 'Razorpay not configured' });
    }
    const { plan, currency = 'INR' } = req.body;
    const PLAN_PRICES = { Basic: 999, Standard: 1999, Premium: 2999 };
    const amount = PLAN_PRICES[plan] || 999;

    const order = await razorpayInstance.orders.create({
      amount: amount * 100,
      currency,
      receipt: 'rcpt_' + Math.random().toString(36).substr(2, 9),
    });
    res.status(200).json({ success: true, data: order });
  } catch (error) { next(error); }
});

app.post('/api/payments/verify', verifyAuth, requireDb, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    await db.collection('users').doc(req.user.uid).update({
      paymentStatus: 'Paid',
      lastPaymentDate: new Date().toISOString(),
    });
    res.status(200).json({ success: true, message: 'Payment verified successfully' });
  } catch (error) { next(error); }
});

app.post('/api/payments/mark-paid', verifyAdmin, requireDb, async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
    await db.collection('users').doc(userId).update({
      paymentStatus: 'Paid',
      lastPaymentDate: new Date().toISOString(),
    });
    res.status(200).json({ success: true, message: 'Payment marked successfully' });
  } catch (error) { next(error); }
});

// =============================================================
// ROUTES: ANALYTICS
// =============================================================

app.post('/api/analytics', analyticsLimiter, requireDb, async (req, res, next) => {
  try {
    const { type, data } = req.body;
    await db.collection('analytics').add({ type, data, timestamp: new Date().toISOString() });
    res.status(200).json({ success: true });
  } catch (error) { next(error); }
});

// =============================================================
// CATCH-ALL: Serve frontend SPA
// =============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// =============================================================
// GLOBAL ERROR HANDLER
// =============================================================
app.use((err, req, res, next) => {
  console.error('❌ Global Error:', err.message);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// =============================================================
// CRON: Daily subscription checks
// =============================================================
const getDaysDiff = (d1, d2) => Math.floor(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));

cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Running daily tasks...');
  if (!db) { console.warn('[CRON] Skipped — DB not available'); return; }

  try {
    const today = new Date();
    const usersSnap = await db.collection('users').where('isDeleted', '==', false).get();
    let batch = db.batch();
    let updates = 0;

    usersSnap.forEach((doc) => {
      if (updates >= 400) return;
      const data = doc.data();
      if (!data.lastPaymentDate) return;

      const daysPassed = getDaysDiff(new Date(data.lastPaymentDate), today);

      if (daysPassed >= 30 && data.paymentStatus !== 'Unpaid') {
        batch.update(doc.ref, { paymentStatus: 'Unpaid' });
        updates++;
      }
      if (daysPassed >= 60 && data.status !== 'inactive') {
        batch.update(doc.ref, { status: 'inactive' });
        updates++;
      }
      if (daysPassed === 27 && data.paymentStatus === 'Paid' && twilioClient) {
        twilioClient.messages.create({
          body: 'Your gym subscription expires in 3 days.',
          from: process.env.TWILIO_PHONE_NUMBER,
          to: `whatsapp:${data.contact}`,
        }).catch(console.error);
      }
    });

    if (updates > 0) await batch.commit();
    console.log(`[CRON] Updated ${updates} user records.`);

    // Purge soft-deleted users older than 90 days
    const deletedSnap = await db.collection('users').where('isDeleted', '==', true).limit(50).get();
    const purgeBatch = db.batch();
    let deletions = 0;

    deletedSnap.forEach((doc) => {
      const deletedAt = new Date(doc.data().deletedAt || today);
      if (getDaysDiff(deletedAt, today) >= 90) {
        purgeBatch.delete(doc.ref);
        admin.auth().deleteUser(doc.id).catch(console.error);
        deletions++;
      }
    });

    if (deletions > 0) await purgeBatch.commit();
    console.log(`[CRON] Permanently deleted ${deletions} users.`);
  } catch (error) {
    console.error('[CRON] Error:', error.message);
  }
});

// =============================================================
// START SERVER
// =============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend server running on port ${PORT}`));