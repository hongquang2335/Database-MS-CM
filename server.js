const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { QueryTypes } = require("sequelize");
const dotenv = require("dotenv");
const { sequelize, Customer, Order, Product, ProductLine } = require("./db/models");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET || "change-this-secret";
const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((acc, item) => {
    const [key, ...rest] = item.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function createSession(user) {
  const token = crypto
    .createHmac("sha256", sessionSecret)
    .update(`${user.role}:${user.username}:${Date.now()}:${Math.random()}`)
    .digest("hex");
  sessions.set(token, { ...user, createdAt: Date.now() });
  return token;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.session_token;
  if (!token) return null;
  return sessions.get(token) || null;
}

function clearSession(req, res) {
  const cookies = parseCookies(req);
  if (cookies.session_token) {
    sessions.delete(cookies.session_token);
  }
  res.setHeader("Set-Cookie", "session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

function buildFilters(query) {
  const filters = [];
  const params = [];

  if (query.startDate) {
    filters.push("o.orderDate >= ?");
    params.push(query.startDate);
  }

  if (query.endDate) {
    filters.push("o.orderDate <= ?");
    params.push(query.endDate);
  }

  if (query.customerNumber) {
    filters.push("c.customerNumber = ?");
    params.push(Number(query.customerNumber));
  }

  if (query.productLine) {
    filters.push("p.productLine = ?");
    params.push(query.productLine);
  }

  if (query.productCode) {
    filters.push("p.productCode = ?");
    params.push(query.productCode);
  }

  if (query.customerKeyword) {
    filters.push("(c.customerName LIKE ? OR c.contactLastName LIKE ? OR c.contactFirstName LIKE ?)");
    params.push(`%${query.customerKeyword}%`, `%${query.customerKeyword}%`, `%${query.customerKeyword}%`);
  }

  if (query.productKeyword) {
    filters.push("(p.productName LIKE ? OR p.productCode LIKE ?)");
    params.push(`%${query.productKeyword}%`, `%${query.productKeyword}%`);
  }

  if (query.status) {
    filters.push("o.status = ?");
    params.push(query.status);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return { whereClause, params };
}

async function runQuery(sql, params = []) {
  return sequelize.query(sql, {
    replacements: params,
    type: QueryTypes.SELECT,
  });
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    res.status(401).json({ message: "Admin unauthorized" });
    return;
  }
  req.sessionUser = session;
  next();
}

app.get("/api/auth/me", (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.json({ authenticated: false, user: null });
    return;
  }

  res.json({
    authenticated: true,
    user: {
      role: session.role,
      username: session.username,
    },
  });
});

app.post("/api/auth/login", (req, res) => {
  try {
    const username = String(req.body.username || "");
    const password = String(req.body.password || "");

    if (
      username === String(process.env.ADMIN_USERNAME || "admin") &&
      password === String(process.env.ADMIN_PASSWORD || "admin123")
    ) {
      const token = createSession({ role: "admin", username });
      res.setHeader("Set-Cookie", `session_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 8}`);
      res.json({ ok: true, user: { role: "admin", username } });
      return;
    }

    res.status(401).json({ message: "Sai tài khoản admin hoặc mật khẩu." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

app.get("/api/health", async (_req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/filters", async (_req, res) => {
  try {
    const [customers, productLines, products, statuses, dateRangeRows] = await Promise.all([
      Customer.findAll({
        attributes: ["customerNumber", "customerName"],
        order: [["customerName", "ASC"]],
        raw: true,
      }),
      ProductLine.findAll({
        attributes: ["productLine"],
        order: [["productLine", "ASC"]],
        raw: true,
      }),
      Product.findAll({
        attributes: ["productCode", "productName", "productLine"],
        order: [["productName", "ASC"]],
        raw: true,
      }),
      Order.findAll({
        attributes: [[sequelize.fn("DISTINCT", sequelize.col("status")), "status"]],
        order: [["status", "ASC"]],
        raw: true,
      }),
      runQuery(`
        SELECT
          DATE_FORMAT(MIN(orderDate), '%Y-%m-%d') AS minOrderDate,
          DATE_FORMAT(MAX(orderDate), '%Y-%m-%d') AS maxOrderDate
        FROM orders
      `),
    ]);

    res.json({
      customers,
      productLines,
      products,
      statuses,
      dateRange: dateRangeRows[0],
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const summarySql = `
      SELECT
        ROUND(COALESCE(SUM(od.quantityOrdered * od.priceEach), 0), 2) AS revenue,
        COUNT(DISTINCT o.orderNumber) AS orders,
        COUNT(DISTINCT c.customerNumber) AS customers,
        COUNT(DISTINCT p.productCode) AS products
      FROM orders o
      JOIN customers c ON c.customerNumber = o.customerNumber
      JOIN orderdetails od ON od.orderNumber = o.orderNumber
      JOIN products p ON p.productCode = od.productCode
      ${whereClause}
    `;

    const avgOrderValueSql = `
      SELECT
        ROUND(COALESCE(AVG(order_total), 0), 2) AS avgOrderValue
      FROM (
        SELECT
          o.orderNumber,
          SUM(od.quantityOrdered * od.priceEach) AS order_total
        FROM orders o
        JOIN customers c ON c.customerNumber = o.customerNumber
        JOIN orderdetails od ON od.orderNumber = o.orderNumber
        JOIN products p ON p.productCode = od.productCode
        ${whereClause}
        GROUP BY o.orderNumber
      ) grouped_orders
    `;

    const monthlySql = `
      SELECT
        DATE_FORMAT(o.orderDate, '%Y-%m') AS period,
        ROUND(SUM(od.quantityOrdered * od.priceEach), 2) AS revenue
      FROM orders o
      JOIN customers c ON c.customerNumber = o.customerNumber
      JOIN orderdetails od ON od.orderNumber = o.orderNumber
      JOIN products p ON p.productCode = od.productCode
      ${whereClause}
      GROUP BY DATE_FORMAT(o.orderDate, '%Y-%m')
      ORDER BY period
    `;

    const productLineSql = `
      SELECT
        p.productLine,
        ROUND(SUM(od.quantityOrdered * od.priceEach), 2) AS revenue
      FROM orders o
      JOIN customers c ON c.customerNumber = o.customerNumber
      JOIN orderdetails od ON od.orderNumber = o.orderNumber
      JOIN products p ON p.productCode = od.productCode
      ${whereClause}
      GROUP BY p.productLine
      ORDER BY revenue DESC
    `;

    const topCustomerSql = `
      SELECT
        c.customerName,
        ROUND(SUM(od.quantityOrdered * od.priceEach), 2) AS revenue
      FROM orders o
      JOIN customers c ON c.customerNumber = o.customerNumber
      JOIN orderdetails od ON od.orderNumber = o.orderNumber
      JOIN products p ON p.productCode = od.productCode
      ${whereClause}
      GROUP BY c.customerNumber, c.customerName
      ORDER BY revenue DESC
      LIMIT 10
    `;

    const [summaryRows, avgOrderValueRows, monthlyRows, productLineRows, topCustomerRows] = await Promise.all([
      runQuery(summarySql, params),
      runQuery(avgOrderValueSql, params),
      runQuery(monthlySql, params),
      runQuery(productLineSql, params),
      runQuery(topCustomerSql, params),
    ]);

    res.json({
      summary: {
        ...summaryRows[0],
        avgOrderValue: avgOrderValueRows[0]?.avgOrderValue || 0,
      },
      monthlySales: monthlyRows,
      productLineSales: productLineRows,
      topCustomers: topCustomerRows,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/reports/orders", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
    const { whereClause, params } = buildFilters(req.query);

    const sql = `
      SELECT
        o.orderNumber,
        DATE_FORMAT(o.orderDate, '%Y-%m-%d') AS orderDate,
        o.status,
        c.customerNumber,
        c.customerName,
        p.productCode,
        p.productName,
        p.productLine,
        od.quantityOrdered,
        ROUND(od.priceEach, 2) AS priceEach,
        ROUND(od.quantityOrdered * od.priceEach, 2) AS lineTotal
      FROM orders o
      JOIN customers c ON c.customerNumber = o.customerNumber
      JOIN orderdetails od ON od.orderNumber = o.orderNumber
      JOIN products p ON p.productCode = od.productCode
      ${whereClause}
      ORDER BY o.orderDate DESC, o.orderNumber DESC
      LIMIT ?
    `;

    const rows = await runQuery(sql, [...params, limit]);
    res.json({ rows, limit });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/pivot/sales", async (req, res) => {
  try {
    const rowDimension = req.query.rowDimension === "customer" ? "customer" : "productLine";
    const { whereClause, params } = buildFilters(req.query);
    const rowField = rowDimension === "customer" ? "c.customerName" : "p.productLine";

    const sql = `
      SELECT
        ${rowField} AS rowLabel,
        DATE_FORMAT(o.orderDate, '%Y-%m') AS columnLabel,
        ROUND(SUM(od.quantityOrdered * od.priceEach), 2) AS total
      FROM orders o
      JOIN customers c ON c.customerNumber = o.customerNumber
      JOIN orderdetails od ON od.orderNumber = o.orderNumber
      JOIN products p ON p.productCode = od.productCode
      ${whereClause}
      GROUP BY rowLabel, DATE_FORMAT(o.orderDate, '%Y-%m')
      ORDER BY rowLabel, columnLabel
    `;

    const rows = await runQuery(sql, params);
    res.json({ rowDimension, rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
  res.json({ ok: true, user: { role: "admin", username: req.sessionUser.username } });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Classicmodels dashboard is running at http://localhost:${port}`);
});
