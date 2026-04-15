const { DataTypes } = require("sequelize");
const { sequelize } = require("./sequelize");

const Customer = sequelize.define(
  "Customer",
  {
    customerNumber: { type: DataTypes.INTEGER, primaryKey: true },
    customerName: DataTypes.STRING,
    contactLastName: DataTypes.STRING,
    contactFirstName: DataTypes.STRING,
  },
  { tableName: "customers", timestamps: false }
);

const Order = sequelize.define(
  "Order",
  {
    orderNumber: { type: DataTypes.INTEGER, primaryKey: true },
    orderDate: DataTypes.DATE,
    status: DataTypes.STRING,
    customerNumber: DataTypes.INTEGER,
  },
  { tableName: "orders", timestamps: false }
);

const Product = sequelize.define(
  "Product",
  {
    productCode: { type: DataTypes.STRING, primaryKey: true },
    productName: DataTypes.STRING,
    productLine: DataTypes.STRING,
  },
  { tableName: "products", timestamps: false }
);

const ProductLine = sequelize.define(
  "ProductLine",
  {
    productLine: { type: DataTypes.STRING, primaryKey: true },
  },
  { tableName: "productlines", timestamps: false }
);

Customer.hasMany(Order, { foreignKey: "customerNumber" });
Order.belongsTo(Customer, { foreignKey: "customerNumber" });
ProductLine.hasMany(Product, { foreignKey: "productLine", sourceKey: "productLine" });
Product.belongsTo(ProductLine, { foreignKey: "productLine", targetKey: "productLine" });

module.exports = {
  sequelize,
  Customer,
  Order,
  Product,
  ProductLine,
};
