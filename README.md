# BADGETwise - Personal Finance Tracker

BADGETwise is a sleek, local-first personal finance application that helps you track your expenses, income, and net worth with ease. It uses a local SQLite database (via sql.js) to keep your data private and accessible.

## Features

- **Transaction Tracking:** Easily record income and expenses with support for mathematical formulas.
- **Account Management:** Track multiple bank accounts, cash, and e-wallets.
- **Net Worth Overview:** Get a live total of your financial standing.
- **Monthly Overview:** Analyze your spending habits month by month.
- **Privacy First:** Your data stays in your browser's local storage. No cloud syncing required.
- **Local SQLite:** Uses SQL.js for robust data management directly in the client.

## Technologies Used

- **HTML5 / CSS3:** Modern responsive layout with glassmorphism effects.
- **JavaScript (Vanilla):** Core logic and UI interactions.
- **SQL.js:** A port of SQLite to WebAssembly for local data storage.
- **Google Fonts:** Nunito and Baloo 2 for a modern, clean look.

## Project Structure

- `home.html`: Main dashboard.
- `pages/`: Contains All Transactions, Monthly Overview, and History pages.
- `assets/css/`: Modular stylesheets (variables, layout, page-specific).
- `assets/js/`: Application logic (`app.js`) and menu handling (`menu.js`).
- `db.js`: Database wrapper for SQL.js interactions.
- `schema.sql`: Database schema definition.

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/YuriHa-op/BudgetingApp.git
   ```
2. Open `home.html` in your favorite web browser.
3. Start tracking your budget!

## Development

The app relies on `sql-wasm.js` and `sql-wasm.wasm` from CDN. Ensure you have an internet connection on first load, or download the assets for offline use.

---

*Designed for personal use and financial clarity.*
