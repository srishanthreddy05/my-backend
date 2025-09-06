const express = require("express");
const cors = require("cors");
const sendBonus = require("./sendBonus");
require("dotenv").config();

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// ✅ Load Firebase service account key
const serviceAccount = require("./serviceAccountKey.json");

// ✅ Initialize Firebase Admin SDK
initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Route: Welcome Bonus on First Login
app.post("/bonus", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "Wallet address is required." });

  try {
    const txHash = await sendBonus(wallet, 25);
    res.json({ success: true, txHash });
  } catch (err) {
    console.error("Error sending bonus:", err);
    res.status(500).json({ error: "Token transfer failed." });
  }
});

// ✅ Route: Daily Check-In
app.post("/daily-checkin", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "Wallet address is required." });

  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("walletAddress", "==", wallet).get();
    if (snapshot.empty) return res.status(404).json({ error: "User not found" });

    const userDoc = snapshot.docs[0];
    const userRef = userDoc.ref;
    const userData = userDoc.data();

    const lastCheckIn = userData.lastCheckIn?.toDate?.() || null;
    const now = new Date();

    const alreadyCheckedIn =
      lastCheckIn &&
      lastCheckIn.getDate() === now.getDate() &&
      lastCheckIn.getMonth() === now.getMonth() &&
      lastCheckIn.getFullYear() === now.getFullYear();

    if (alreadyCheckedIn) {
      return res.status(400).json({ error: "Already checked in today!" });
    }

    const txHash = await sendBonus(wallet, 2);
    await userRef.update({ lastCheckIn: now });

    res.json({ success: true, txHash });
  } catch (err) {
    console.error("Daily check-in error:", err);
    res.status(500).json({ error: "Daily check-in failed" });
  }
});

// ✅ Route: Start Mining
app.post("/mine", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "Wallet address is required." });

  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("walletAddress", "==", wallet).get();
    if (snapshot.empty) return res.status(404).json({ error: "User not found" });

    const userDoc = snapshot.docs[0];
    const userRef = userDoc.ref;
    const userData = userDoc.data();

    const now = new Date();
    const lastMineTime = userData.lastMineTime?.toDate?.() || null;

    if (lastMineTime) {
      const timeDiff = now - lastMineTime;
      const hoursPassed = timeDiff / (1000 * 60 * 60);
      if (hoursPassed < 24) {
        return res.status(400).json({ error: `Mining cooldown: try after ${Math.ceil(24 - hoursPassed)} hours` });
      }
    }

    await userRef.update({
      lastMineTime: now,
      miningReady: true
    });

    res.json({ success: true, message: "Mining started. Come back in 24 hrs." });
  } catch (err) {
    console.error("Mining error:", err);
    res.status(500).json({ error: "Mining start failed" });
  }
});

// ✅ Route: Claim Mining Reward
app.post("/claim", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "Wallet address is required." });

  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("walletAddress", "==", wallet).get();
    if (snapshot.empty) return res.status(404).json({ error: "User not found" });

    const userDoc = snapshot.docs[0];
    const userRef = userDoc.ref;
    const userData = userDoc.data();

    const lastMineTime = userData.lastMineTime?.toDate?.();
    const miningReady = userData.miningReady;

    if (!lastMineTime || !miningReady) {
      return res.status(400).json({ error: "Mining not ready. Start mining first." });
    }

    const now = new Date();
    const hoursPassed = (now - lastMineTime) / (1000 * 60 * 60);
    if (hoursPassed < 24) {
      return res.status(400).json({ error: `Still mining. Wait ${Math.ceil(24 - hoursPassed)} more hours.` });
    }

    const txHash = await sendBonus(wallet, 5);

    await userRef.update({
      miningReady: false
    });

    res.json({ success: true, txHash });
  } catch (err) {
    console.error("Claim error:", err);
    res.status(500).json({ error: "Failed to claim reward." });
  }
});

// Add these routes to your index.js file

// ✅ Route: Submit Game Score and Get Coins
app.post("/submit-score", async (req, res) => {
  const { wallet, gameType, score } = req.body;
  
  if (!wallet) return res.status(400).json({ error: "Wallet address is required." });
  if (!gameType || !score) return res.status(400).json({ error: "Game type and score are required." });
  
  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("walletAddress", "==", wallet).get();
    if (snapshot.empty) return res.status(404).json({ error: "User not found" });

    const userDoc = snapshot.docs[0];
    const userRef = userDoc.ref;
    const userData = userDoc.data();
    
    // Calculate coins based on score (score × 0.1)
    const coinsToEarn = Math.floor(score * 0.1);
    
    // Check daily game limits (optional anti-abuse measure)
    const today = new Date().toDateString();
    const gameEarnings = userData.gameEarnings || {};
    const todayEarnings = gameEarnings[today] || {};
    const gameTypeEarnings = todayEarnings[gameType] || 0;
    
    // Optional: Set daily limits per game (e.g., max 100 coins per game per day)
    const dailyLimit = 100;
    if (gameTypeEarnings >= dailyLimit) {
      return res.status(400).json({ 
        error: `Daily earning limit reached for ${gameType}. Try again tomorrow!` 
      });
    }
    
    // Send tokens immediately
    const txHash = await sendBonus(wallet, coinsToEarn);
    
    // Update user's game earnings tracking
    const updatedEarnings = {
      ...gameEarnings,
      [today]: {
        ...todayEarnings,
        [gameType]: gameTypeEarnings + coinsToEarn
      }
    };
    
    await userRef.update({ gameEarnings: updatedEarnings });
    
    res.json({ 
      success: true, 
      txHash,
      coinsEarned: coinsToEarn,
      todayTotal: gameTypeEarnings + coinsToEarn
    });
    
  } catch (err) {
    console.error("Score submission error:", err);
    res.status(500).json({ error: "Failed to process game score" });
  }
});

// ✅ Route: Batch Claim Daily Game Rewards
app.post("/claim-game-rewards", async (req, res) => {
  const { wallet } = req.body;
  
  if (!wallet) return res.status(400).json({ error: "Wallet address is required." });
  
  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("walletAddress", "==", wallet).get();
    if (snapshot.empty) return res.status(404).json({ error: "User not found" });

    const userDoc = snapshot.docs[0];
    const userRef = userDoc.ref;
    const userData = userDoc.data();
    
    const today = new Date().toDateString();
    const pendingRewards = userData.pendingGameRewards || {};
    const todayRewards = pendingRewards[today] || {};
    
    // Calculate total pending coins for today
    const totalCoins = Object.values(todayRewards).reduce((sum, coins) => sum + coins, 0);
    
    if (totalCoins === 0) {
      return res.status(400).json({ error: "No pending game rewards to claim" });
    }
    
    // Send total coins to wallet
    const txHash = await sendBonus(wallet, totalCoins);
    
    // Clear today's pending rewards
    const updatedPendingRewards = { ...pendingRewards };
    delete updatedPendingRewards[today];
    
    await userRef.update({ 
      pendingGameRewards: updatedPendingRewards,
      lastGameRewardClaim: new Date()
    });
    
    res.json({ 
      success: true, 
      txHash,
      totalClaimed: totalCoins,
      breakdown: todayRewards
    });
    
  } catch (err) {
    console.error("Game rewards claim error:", err);
    res.status(500).json({ error: "Failed to claim game rewards" });
  }
});

// ✅ Route: Add Coins to Pending Rewards (for batch claiming)
app.post("/add-pending-reward", async (req, res) => {
  const { wallet, gameType, score } = req.body;
  
  if (!wallet) return res.status(400).json({ error: "Wallet address is required." });
  if (!gameType || !score) return res.status(400).json({ error: "Game type and score are required." });
  
  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("walletAddress", "==", wallet).get();
    if (snapshot.empty) return res.status(404).json({ error: "User not found" });

    const userDoc = snapshot.docs[0];
    const userRef = userDoc.ref;
    const userData = userDoc.data();
    
    const coinsToEarn = Math.floor(score * 0.1);
    const today = new Date().toDateString();
    
    // Add to pending rewards
    const pendingRewards = userData.pendingGameRewards || {};
    const todayRewards = pendingRewards[today] || {};
    todayRewards[gameType] = (todayRewards[gameType] || 0) + coinsToEarn;
    
    const updatedPendingRewards = {
      ...pendingRewards,
      [today]: todayRewards
    };
    
    await userRef.update({ pendingGameRewards: updatedPendingRewards });
    
    res.json({ 
      success: true, 
      coinsEarned: coinsToEarn,
      todayPending: Object.values(todayRewards).reduce((sum, coins) => sum + coins, 0)
    });
    
  } catch (err) {
    console.error("Pending reward error:", err);
    res.status(500).json({ error: "Failed to add pending reward" });
  }
});

// ✅ Route: Get User's Game Stats
app.get("/game-stats/:wallet", async (req, res) => {
  const { wallet } = req.params;
  
  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("walletAddress", "==", wallet).get();
    if (snapshot.empty) return res.status(404).json({ error: "User not found" });

    const userData = snapshot.docs[0].data();
    const today = new Date().toDateString();
    
    const gameEarnings = userData.gameEarnings || {};
    const pendingRewards = userData.pendingGameRewards || {};
    const todayEarnings = gameEarnings[today] || {};
    const todayPending = pendingRewards[today] || {};
    
    res.json({
      todayEarnings,
      todayPending,
      totalPending: Object.values(todayPending).reduce((sum, coins) => sum + coins, 0),
      totalEarnedToday: Object.values(todayEarnings).reduce((sum, coins) => sum + coins, 0)
    });
    
  } catch (err) {
    console.error("Game stats error:", err);
    res.status(500).json({ error: "Failed to get game stats" });
  }
});

// ✅ Start Express Server
const PORT = 3010;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
