const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const TOP_UP_METHODS = new Set(["bKash", "Nagad", "Card", "Other"]);
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const [account, transactions] = await Promise.all([
      pool.query("SELECT balance, updated_at FROM wallet_account WHERE user_id = $1", [req.user.user_id]),
      pool.query(
        `SELECT wt.transaction_id, wt.transaction_type, wt.amount, wt.balance_after,
                wt.payment_method, wt.reference_code, wt.pnr_number, wt.created_at,
                actor.first_name AS actor_first_name, actor.last_name AS actor_last_name
         FROM wallet_transaction wt
         LEFT JOIN users actor ON actor.user_id = wt.actor_user_id
         WHERE wt.user_id = $1
         ORDER BY wt.created_at DESC, wt.transaction_id DESC LIMIT 100`, [req.user.user_id]
      ),
    ]);
    res.json({ balance: account.rows[0]?.balance || "0.00", transactions: transactions.rows });
  } catch (err) { next(err); }
});

router.post("/top-ups", async (req, res, next) => {
  const amountText = typeof req.body?.amount === "string" ? req.body.amount : String(req.body?.amount ?? "");
  const method = req.body?.method;
  const reference = typeof req.body?.reference_code === "string" ? req.body.reference_code.trim() : "";
  const amount = Number(amountText);
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount < 10 || amount > 50000 || !TOP_UP_METHODS.has(method) || reference.length > 100) {
    return res.status(400).json({ error: "Enter an amount from ৳10 to ৳50,000, choose a method, and keep the reference under 100 characters." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO wallet_account(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [req.user.user_id]);
    const { rows } = await client.query(
      `UPDATE wallet_account SET balance = balance + $2, updated_at = now()
       WHERE user_id = $1 RETURNING balance`, [req.user.user_id, amount]
    );
    const transaction = await client.query(
      `INSERT INTO wallet_transaction(user_id, transaction_type, amount, balance_after, payment_method, reference_code)
       VALUES ($1, 'top_up', $2, $3, $4, $5)
       RETURNING transaction_id, transaction_type, amount, balance_after, payment_method, reference_code, created_at`,
      [req.user.user_id, amount, rows[0].balance, method, reference || null]
    );
    await client.query("COMMIT");
    res.status(201).json({ balance: rows[0].balance, transaction: transaction.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "That top-up reference has already been used for this payment method." });
    next(err);
  } finally { client.release(); }
});

module.exports = router;
