require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { handleIncomingMessage } = require("./logic");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("Order Management System ✅ Running"));

/**
 * Webhook verification (Meta)
 * GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * Webhook receiver
 */
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from; // customer phone number
      const text = msg.text?.body || "";

      await handleIncomingMessage(from, text);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    // Always return 200 to avoid WhatsApp retries spamming
    return res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
