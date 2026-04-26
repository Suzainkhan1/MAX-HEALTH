require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require("firebase-admin");
const cron = require('node-cron');
const twilio = require('twilio');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Initialize Firebase Admin (Only ONE initialization)
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  }

  if (serviceAccount && !admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin Initialized");
  }
} catch (error) {
  console.error("Firebase Init Error:", error.message);
}

if (!admin.apps.length) {
  throw new Error("Firebase not initialized properly");
}
const db = admin.firestore();

// Initialize Twilio
let twilioClient;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log("Twilio API Initialized");
  }
} catch (error) {
  console.error("Failed to initialize Twilio.", error.message);
}

// Initialize Razorpay
let razorpayInstance;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  console.log("Razorpay Initialized");
} else {
  console.log("Razorpay not configured (DEV MODE)");
}


// Helper to calculate days difference
const getDaysDifference = (date1, date2) => {
  const diffTime = Math.abs(date2 - date1);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

// Debug route
app.get('/test', (req, res) => {
  res.send("Server working");
});

// POST /api/signup
app.post('/api/signup', async (req, res) => {
  try {
    const { uid, name, email, contact, address, plan, joinDate, paymentStatus } = req.body;

    if (!db) {
      return res.status(500).json({ error: "Backend services not fully configured." });
    }

    const userData = {
      uid, name, email, contact, address, plan, joinDate, paymentStatus,
      lastPaymentDate: new Date().toISOString()
    };

    // Save to Firestore ONLY
    await db.collection("users").doc(uid).set(userData);

    res.status(200).json({ success: true, message: "User synced successfully." });
  } catch (error) {
    console.error("Signup Sync Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments/mark-paid (Manual via Admin)
app.post('/api/payments/mark-paid', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!db) {
      return res.status(500).json({ error: "Backend services not fully configured." });
    }

    const today = new Date().toISOString();

    // Update Firestore
    await db.collection("users").doc(userId).update({
      paymentStatus: "Paid",
      lastPaymentDate: today
    });

    res.status(200).json({ success: true, message: "Payment marked successfully." });
  } catch (error) {
    console.error("Mark Paid Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments/create-order (Razorpay)
app.post('/api/payments/create-order', async (req, res) => {
  try {
    const { amount, plan, currency = "INR" } = req.body;

    if (!razorpayInstance) {
      return res.status(500).json({ error: "Razorpay not configured." });
    }

    console.log("Create order requested:", req.body);

    // Compute finalAmount based on plan, fallback to amount
    let finalAmount = amount || 999;

    if (plan === "Basic") finalAmount = 999;
    if (plan === "Standard") finalAmount = 1999;
    if (plan === "Premium") finalAmount = 2999;

    const options = {
      amount: finalAmount * 100, // Amount in paisa
      currency,
      receipt: "receipt_" + Math.random().toString(36).substr(2, 9)
    };

    const order = await razorpayInstance.orders.create(options);
    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments/verify (Razorpay Success Handler)
app.post('/api/payments/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId } = req.body;

    if (!db) {
      return res.status(500).json({ error: "Database not configured." });
    }

    let isSignatureValid = true;

    if (process.env.RAZORPAY_KEY_SECRET) {
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

      isSignatureValid = expectedSignature === razorpay_signature;
    }

    if (isSignatureValid) {
      const today = new Date().toISOString();
      await db.collection("users").doc(userId).update({
        paymentStatus: "Paid",
        lastPaymentDate: today
      });
      res.status(200).json({ success: true, message: "Payment verified successfully" });
    } else {
      res.status(400).json({ success: false, error: "Invalid signature" });
    }
  } catch (error) {
    console.error("Payment Verification Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// CRON JOB: Runs every day at 00:00 (Midnight)
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily cron job for expiry and reminders...');
  if (!db) return;

  try {
    const usersSnapshot = await db.collection("users").get();
    const today = new Date();

    const batch = db.batch();
    let hasUpdates = false;

    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      if (!data.lastPaymentDate) continue;

      const lastPaid = new Date(data.lastPaymentDate);
      const daysPassed = getDaysDifference(lastPaid, today);

      // 1. Auto Expiry Logic (30 days)
      if (daysPassed >= 30 && data.paymentStatus !== "Unpaid") {
        console.log(`Marking user ${data.name} as Unpaid.`);
        batch.update(doc.ref, { paymentStatus: "Unpaid" });
        hasUpdates = true;
      }

      // 2. Reminder Logic (27 days passed -> 3 days remaining)
      if (daysPassed === 27 && data.paymentStatus === "Paid" && twilioClient) {
        console.log(`Sending reminder to ${data.name} at ${data.contact}`);
        try {
          await twilioClient.messages.create({
            body: "Your gym subscription is about to expire in 3 days. Please renew to continue your services.",
            from: process.env.TWILIO_PHONE_NUMBER,
            to: `whatsapp:${data.contact}` // Fallback to normal if SMS
          });
        } catch (msgErr) {
          console.error("Failed to send message to", data.contact, msgErr.message);
        }
      }
    }

    if (hasUpdates) {
      await batch.commit();
    }

  } catch (error) {
    console.error("Cron Job Error:", error);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
