(function () {
  'use strict';

  const ACTIVE_USER_KEY = 'budgetwise_active_user_id';
  const DB_BLOB_KEY = 'budgetwise_db_v1';
  const DATA_VERSION_KEY = 'budgetwise_data_version';
  const DATA_VERSION_VALUE = '2';
  const EXCLUDED_TX_KEY = 'budgetwise_excluded_tx_ids';
  const PEOPLE_OWE_KEY = 'budgetwise_people_owe_v1';
  const PEOPLE_IOWE_KEY = 'budgetwise_people_iowe_v1';
  const INCLUDE_OWED_KEY = 'budgetwise_include_owed';
  const WEEKLY_FORECAST_KEY = 'budgetwise_weekly_forecast_v1';
  const WEEKLY_FORECAST_GOAL_KEY = 'budgetwise_weekly_forecast_goal_v1';
  const MONTHLY_OVERVIEW_MONTH_KEY = 'budgetwise_monthly_overview_month';
  const HOME_PAGE = 'home.html';
  const AUTH_PAGE = 'auth.html';

  let db = null;
  let activeUser = null;
  let editingTransaction = null;
  let transactionMode = 'edit';
  let homeCalendar = null;
  let homeTxLimit = 12;

  let currentAccountMode = 'create';
  let currentAccount = null;
  let pendingAccountTxns = [];

  let currentPeopleListType = 'owe';
  let currentPeopleMode = 'create';
  let currentPeopleItem = null;
  let pendingPeopleTxns = [];
  let lastRenderedNetWorth = null;
  let topCategoriesChart = null;
  let cumulativeChart = null;

  const allTxState = {
    search: '',
    month: 'this_month',
    includeFuture: true,
    type: 'all',
    category: 'all',
    view: 'table'
  };

  function money(value) {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  function fmtDate(isoDate) {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric'
    });
  }

  function initials(text) {
    if (!text) {
      return 'NA';
    }

    return text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toInputDate(isoDate) {
    if (!isoDate) {
      return new Date().toISOString().slice(0, 10);
    }
    return String(isoDate).slice(0, 10);
  }

  function accountDelta(amount, type, direction) {
    const normalizedAmount = Number(amount || 0) * Number(direction || 1);
    return type === 'income' ? normalizedAmount : -normalizedAmount;
  }

  function getAccountForUser(accountId) {
    if (!accountId || !activeUser) {
      return null;
    }
    return db.queryValue('SELECT * FROM accounts WHERE id = ? AND user_id = ? LIMIT 1;', [Number(accountId), activeUser.id]);
  }

  function projectedAccountBalance(accountId, pendingTxns) {
    const account = getAccountForUser(accountId);
    if (!account) {
      return null;
    }

    let projected = Number(account.balance || 0);
    const rows = Array.isArray(pendingTxns) ? pendingTxns : [];
    rows.forEach((txn) => {
      if (Number(txn.accountId || txn.account_id) === Number(accountId)) {
        projected += accountDelta(txn.amount, txn.type, 1);
      }
    });

    return projected;
  }

  function ensureTransactionWillNotOverdraw(payload, existingTx) {
    const projectedByAccount = new Map();

    function applyDelta(accountId, delta) {
      const key = Number(accountId);
      if (!Number.isFinite(key)) {
        return false;
      }

      let current = projectedByAccount.get(key);
      if (current === undefined) {
        const account = getAccountForUser(key);
        if (!account) {
          return false;
        }
        current = Number(account.balance || 0);
      }

      const next = current + Number(delta || 0);
      projectedByAccount.set(key, next);
      return next >= 0;
    }

    if (existingTx) {
      const revertDelta = accountDelta(existingTx.amount, existingTx.type, -1);
      if (!applyDelta(existingTx.account_id, revertDelta)) {
        return false;
      }
    }

    const applyNewDelta = accountDelta(payload.amount, payload.type, 1);
    return applyDelta(payload.account_id, applyNewDelta);
  }

  function launchNetWorthMood(delta) {
    const hosts = [
      document.getElementById('netWorthFx'),
      document.getElementById('homeTransactionsFx')
    ].filter(Boolean);
    const moodTargets = [
      document.querySelector('.networth-box'),
      document.querySelector('.home-transactions-wrap')
    ].filter(Boolean);

    if (hosts.length === 0 || Math.abs(delta) < 0.01) {
      return;
    }

    const upbeat = delta > 0;
    const pieces = upbeat ? 42 : 34;

    moodTargets.forEach((el) => {
      el.classList.remove('mood-up', 'mood-down');
      // Trigger reflow so the class animation can restart on consecutive updates.
      void el.offsetWidth;
      el.classList.add(upbeat ? 'mood-up' : 'mood-down');
    });

    hosts.forEach((fxHost) => {
      fxHost.innerHTML = '';
      fxHost.classList.remove('upbeat', 'downbeat');
      fxHost.classList.add(upbeat ? 'upbeat' : 'downbeat');

      for (let i = 0; i < pieces; i += 1) {
        const particle = document.createElement('span');
        particle.className = 'networth-particle';
        particle.style.left = `${4 + Math.random() * 92}%`;
        particle.style.top = `${upbeat ? 24 + Math.random() * 26 : 2 + Math.random() * 20}%`;
        particle.style.setProperty('--dx', `${-90 + Math.random() * 180}px`);
        particle.style.setProperty('--delay', `${Math.random() * 0.3}s`);
        particle.style.setProperty('--dur', `${0.95 + Math.random() * 0.75}s`);
        particle.style.setProperty('--rot', `${Math.random() * 360}deg`);
        fxHost.appendChild(particle);
      }
    });

    window.setTimeout(function () {
      hosts.forEach((fxHost) => {
        fxHost.innerHTML = '';
        fxHost.classList.remove('upbeat', 'downbeat');
      });
      moodTargets.forEach((el) => {
        el.classList.remove('mood-up', 'mood-down');
      });
    }, 1600);
  }

  function currentPage() {
    return window.location.pathname.split('/').pop() || HOME_PAGE;
  }

  function authPagePath() {
    if (window.location.pathname.includes('/pages/')) {
      return '../auth.html';
    }
    return 'auth.html';
  }

  function schemaPathForPage() {
    if (window.location.pathname.includes('/pages/')) {
      return '../schema.sql';
    }
    return 'schema.sql';
  }

  function includeOwed() {
    return localStorage.getItem(userScopedKey(INCLUDE_OWED_KEY)) === '1';
  }

  function setIncludeOwed(value) {
    localStorage.setItem(userScopedKey(INCLUDE_OWED_KEY), value ? '1' : '0');
  }

  function userScopedKey(baseKey) {
    if (!activeUser || !activeUser.id) {
      return baseKey;
    }
    return `${baseKey}_${activeUser.id}`;
  }

  function readActiveUser() {
    const savedId = Number(localStorage.getItem(ACTIVE_USER_KEY));
    if (savedId) {
      const found = db.getUserById(savedId);
      if (found) {
        return found;
      }
    }

    return null;
  }

  function getExcludedSet() {
    try {
      const value = localStorage.getItem(userScopedKey(EXCLUDED_TX_KEY));
      const parsed = value ? JSON.parse(value) : [];
      return new Set(parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
    } catch (_error) {
      return new Set();
    }
  }

  function saveExcludedSet(setRef) {
    localStorage.setItem(userScopedKey(EXCLUDED_TX_KEY), JSON.stringify(Array.from(setRef)));
  }

  function getPeopleByType(type) {
    const key = userScopedKey(type === 'iowe' ? PEOPLE_IOWE_KEY : PEOPLE_OWE_KEY);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return [];
      }
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) {
        return [];
      }
      return rows
        .filter((item) => item && typeof item.name === 'string')
        .map((item) => ({
          id: Number(item.id),
          name: item.name,
          amount: Number(item.amount || 0)
        }));
    } catch (_error) {
      return [];
    }
  }

  function savePeopleByType(type, rows) {
    const key = userScopedKey(type === 'iowe' ? PEOPLE_IOWE_KEY : PEOPLE_OWE_KEY);
    localStorage.setItem(key, JSON.stringify(rows));
  }

  function nextPeopleId(type) {
    const rows = getPeopleByType(type);
    const max = rows.reduce((acc, item) => Math.max(acc, Number(item.id || 0)), 0);
    return max + 1;
  }

  function ensureFreshStartForV2() {
    if (localStorage.getItem(DATA_VERSION_KEY) === DATA_VERSION_VALUE) {
      return;
    }

    const keysToRemove = [
      DB_BLOB_KEY,
      ACTIVE_USER_KEY,
      EXCLUDED_TX_KEY,
      PEOPLE_OWE_KEY,
      PEOPLE_IOWE_KEY,
      INCLUDE_OWED_KEY,
      WEEKLY_FORECAST_KEY,
      WEEKLY_FORECAST_GOAL_KEY,
      MONTHLY_OVERVIEW_MONTH_KEY
    ];

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(`${EXCLUDED_TX_KEY}_`) ||
          key.startsWith(`${PEOPLE_OWE_KEY}_`) ||
          key.startsWith(`${PEOPLE_IOWE_KEY}_`) ||
          key.startsWith(`${INCLUDE_OWED_KEY}_`) ||
          key.startsWith(`${WEEKLY_FORECAST_KEY}_`) ||
          key.startsWith(`${WEEKLY_FORECAST_GOAL_KEY}_`)) {
        localStorage.removeItem(key);
      }
    });

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(DATA_VERSION_KEY, DATA_VERSION_VALUE);
  }

  function ensureUserDefaults() {
    const peopleOweKey = userScopedKey(PEOPLE_OWE_KEY);
    const peopleIOweKey = userScopedKey(PEOPLE_IOWE_KEY);
    const includeOwedKey = userScopedKey(INCLUDE_OWED_KEY);

    if (!localStorage.getItem(peopleOweKey)) {
      localStorage.setItem(peopleOweKey, '[]');
    }
    if (!localStorage.getItem(peopleIOweKey)) {
      localStorage.setItem(peopleIOweKey, '[]');
    }
    if (localStorage.getItem(includeOwedKey) === null) {
      localStorage.setItem(includeOwedKey, '0');
    }
  }

  function normalizeLower(value) {
    return String(value || '').toLowerCase();
  }

  function currentMonthKey() {
    return new Date().toISOString().slice(0, 7);
  }

  function selectedOverviewMonth() {
    const select = document.getElementById('monthlyBoardMonth');
    if (select && select.value) {
      return select.value;
    }
    const saved = localStorage.getItem(MONTHLY_OVERVIEW_MONTH_KEY);
    return saved || currentMonthKey();
  }

  function monthRange(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { start, end };
  }

  function sameMonth(dateObj, monthKey) {
    const ym = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    return ym === monthKey;
  }

  function renderMonthlyCategoryTable(expenseRows, paceFactor) {
    const tbody = document.getElementById('monthlyCategoryBody');
    if (!tbody) {
      return;
    }

    if (expenseRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No expense data.</td></tr>';
      return;
    }

    const grouped = {};
    expenseRows.forEach((row) => {
      const key = row.category_name || 'Uncategorized';
      grouped[key] = (grouped[key] || 0) + Number(row.amount || 0);
    });

    const entries = Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16);

    tbody.innerHTML = entries.map(([name, current], index) => {
      const expected = current * paceFactor;
      const pct = expected > 0 ? (current / expected) * 100 : 0;
      const pctClass = pct > 100 ? 'progress-danger' : (pct > 85 ? 'progress-warn' : 'progress-good');
      const badge = index === 0 ? '<span class="monthly-cat-badge">Top</span>' : '';
      return `
        <tr>
          <td>${escapeHtml(name)} ${badge}</td>
          <td class="align-right">${escapeHtml(money(expected))}</td>
          <td class="align-right">${escapeHtml(money(current))}</td>
          <td class="align-right ${pctClass}">${escapeHtml(`${pct.toFixed(0)}%`)}</td>
        </tr>
      `;
    }).join('');
  }

  function renderWeeklySpending(monthKey, txs) {
    const listEl = document.getElementById('weeklySpendingList');
    const summaryEl = document.getElementById('weeklySpendingSummary');
    if (!listEl || !summaryEl) {
      return;
    }

    const { start, end } = monthRange(monthKey);
    const excludedExpense = new Set(['savings', 'investment']);
    const expenseRows = txs.filter((row) => {
      if (row.type !== 'expense') {
        return false;
      }
      const cat = normalizeLower(row.category_name);
      for (const token of excludedExpense) {
        if (cat.includes(token)) {
          return false;
        }
      }
      return true;
    });

    const buckets = [];
    let weekStart = new Date(start);
    while (weekStart <= end) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      if (weekEnd > end) {
        weekEnd.setTime(end.getTime());
      }
      buckets.push({
        start: new Date(weekStart),
        end: new Date(weekEnd),
        total: 0
      });
      weekStart.setDate(weekStart.getDate() + 7);
    }

    expenseRows.forEach((row) => {
      const d = new Date(String(row.date).slice(0, 10));
      const found = buckets.find((bucket) => d >= bucket.start && d <= bucket.end);
      if (found) {
        found.total += Number(row.amount || 0);
      }
    });

    const max = Math.max(1, ...buckets.map((b) => b.total));
    listEl.innerHTML = buckets.map((bucket) => {
      const width = Math.max(2, (bucket.total / max) * 100);
      const label = `${bucket.start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}-${bucket.end.toLocaleDateString('en-PH', { day: 'numeric' })}`;
      return `
        <div class="weekly-spending-item">
          <span class="week-label">${escapeHtml(label)}</span>
          <div class="week-bar"><span style="width:${width.toFixed(1)}%"></span></div>
          <span class="week-value">${escapeHtml(money(bucket.total))}</span>
        </div>
      `;
    }).join('');

    const monthTotal = buckets.reduce((sum, b) => sum + b.total, 0);
    const avg = buckets.length > 0 ? monthTotal / buckets.length : 0;
    summaryEl.textContent = `Month to date: ${money(monthTotal)} · Avg/week: ${money(avg)}`;
  }

  function renderMoneyInOut(expectedIncome, expectedExpense, actualIncome, actualExpense) {
    const expectedIncomeEl = document.getElementById('monthlyExpectedIncome');
    const expectedExpenseEl = document.getElementById('monthlyExpectedExpense');
    const actualIncomeEl = document.getElementById('monthlyActualIncome');
    const actualExpenseEl = document.getElementById('monthlyActualExpense');
    const expectedIoBar = document.getElementById('monthlyExpectedIoBar');
    const actualIoBar = document.getElementById('monthlyActualIoBar');

    if (!expectedIncomeEl || !expectedExpenseEl || !actualIncomeEl || !actualExpenseEl || !expectedIoBar || !actualIoBar) {
      return;
    }

    expectedIncomeEl.textContent = money(expectedIncome);
    expectedExpenseEl.textContent = money(expectedExpense);
    actualIncomeEl.textContent = money(actualIncome);
    actualExpenseEl.textContent = money(actualExpense);

    const expectedRatio = expectedIncome > 0 ? Math.min(100, (expectedExpense / expectedIncome) * 100) : 0;
    const actualRatio = actualIncome > 0 ? Math.min(100, (actualExpense / actualIncome) * 100) : 0;

    expectedIoBar.style.width = `${expectedRatio.toFixed(1)}%`;
    actualIoBar.style.width = `${actualRatio.toFixed(1)}%`;
  }

  function renderTopCategoriesChart(expenseRows) {
    const canvas = document.getElementById('monthlyTopCategoriesChart');
    const legend = document.getElementById('monthlyTopCategoriesLegend');
    if (!canvas || !legend) {
      return;
    }

    const grouped = {};
    expenseRows.forEach((row) => {
      const key = row.category_name || 'Uncategorized';
      grouped[key] = (grouped[key] || 0) + Number(row.amount || 0);
    });

    const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = entries.map(([name]) => name);
    const values = entries.map(([, value]) => value);
    const total = values.reduce((sum, n) => sum + n, 0);
    const palette = ['#6e7ff0', '#f08ca0', '#7bc6ff', '#f5ba65', '#8ad17f', '#bb96f4', '#64d8c0', '#f391d4'];

    legend.innerHTML = entries.length === 0
      ? '<li><span class="left">No data</span><span>0%</span></li>'
      : entries.map(([name, amount], idx) => {
        const pct = total > 0 ? (amount / total) * 100 : 0;
        return `<li><span class="left"><span class="dot" style="background:${palette[idx % palette.length]}"></span>${escapeHtml(name)}</span><span>${escapeHtml(`${pct.toFixed(1)}%`)}</span></li>`;
      }).join('');

    if (!window.Chart) {
      return;
    }

    if (topCategoriesChart) {
      topCategoriesChart.destroy();
      topCategoriesChart = null;
    }

    topCategoriesChart = new window.Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map((_, idx) => palette[idx % palette.length]),
          borderWidth: 0,
          hoverOffset: 2
        }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: { size: 14 },
            bodyFont: { size: 14 },
            callbacks: {
              label: function (context) {
                return `${context.label}: ${money(context.parsed)}`;
              }
            }
          }
        },
        cutout: '52%'
      }
    });
  }

  function renderCumulativeChart(monthKey, expenseRows) {
    const canvas = document.getElementById('monthlyCumulativeChart');
    if (!canvas || !window.Chart) {
      return;
    }

    const { start, end } = monthRange(monthKey);
    const days = end.getDate();
    const labels = [];
    const actualSeries = [];
    const budgetSeries = [];

    const byDay = {};
    expenseRows.forEach((row) => {
      const d = new Date(String(row.date).slice(0, 10));
      const day = d.getDate();
      byDay[day] = (byDay[day] || 0) + Number(row.amount || 0);
    });

    const weeklyState = getWeeklyForecastState();
    const monthlyBudget = Math.max(0, Number(weeklyState.weeklyExpenses || 0)) * 4.345;
    const pacePerDay = days > 0 ? monthlyBudget / days : 0;
    let actualRunning = 0;
    let budgetRunning = 0;

    for (let day = 1; day <= days; day += 1) {
      const current = new Date(start.getFullYear(), start.getMonth(), day);
      labels.push(current.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
      actualRunning += Number(byDay[day] || 0);
      budgetRunning += pacePerDay;
      actualSeries.push(Number(actualRunning.toFixed(2)));
      budgetSeries.push(Number(budgetRunning.toFixed(2)));
    }

    if (cumulativeChart) {
      cumulativeChart.destroy();
      cumulativeChart = null;
    }

    cumulativeChart = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Actual',
            data: actualSeries,
            borderColor: '#f08ca0',
            backgroundColor: 'rgba(240, 140, 160, 0.15)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: 'Budget Pace',
            data: budgetSeries,
            borderColor: '#6e7ff0',
            borderDash: [5, 4],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              boxWidth: 12,
              color: '#4c487d',
              font: { size: 13 }
            }
          },
          tooltip: {
            titleFont: { size: 14 },
            bodyFont: { size: 14 },
            callbacks: {
              label: function (context) {
                return `${context.dataset.label}: ${money(context.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 6, color: '#635f8f', font: { size: 12 } },
            grid: { color: 'rgba(102, 80, 171, 0.1)' }
          },
          y: {
            ticks: {
              color: '#635f8f',
              font: { size: 12 },
              callback: function (value) {
                return money(value);
              }
            },
            grid: { color: 'rgba(102, 80, 171, 0.12)' }
          }
        }
      }
    });
  }

  function currentYearKey() {
    return new Date().toISOString().slice(0, 4);
  }

  function categoryNameById(id) {
    if (!id) {
      return '-';
    }
    const row = db.queryValue('SELECT name FROM categories WHERE id = ? LIMIT 1;', [id]);
    return row ? row.name : '-';
  }

  function evaluateFormula(rawInput) {
    const input = String(rawInput || '').trim();
    if (!input) {
      return { valid: false, value: 0, text: 'Enter an amount or formula' };
    }

    const nums = input.match(/[+-]?\d+(?:\.\d+)?/g);
    if (!nums || nums.length === 0) {
      return { valid: false, value: 0, text: 'No numeric values found' };
    }

    const total = nums.reduce((sum, token) => sum + Number(token), 0);
    if (!Number.isFinite(total)) {
      return { valid: false, value: 0, text: 'Invalid result' };
    }

    return { valid: true, value: total, text: `= ${money(total)}` };
  }

  function fillCategorySelect(type, selectedId) {
    const categorySelect = document.getElementById('editTxnCategory');
    if (!categorySelect) {
      return;
    }

    const categories = db.listCategories(type);
    categorySelect.innerHTML = categories
      .map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`)
      .join('');

    if (selectedId) {
      categorySelect.value = String(selectedId);
    }
  }

  function fillAccountSelect(selectedId) {
    const accountSelect = document.getElementById('editTxnAccount');
    if (!accountSelect) {
      return;
    }

    const accounts = db.listAccounts(activeUser.id);
    accountSelect.innerHTML = accounts
      .map((acc) => `<option value="${acc.id}">${escapeHtml(acc.name)} (${escapeHtml(money(acc.balance))})</option>`)
      .join('');

    if (selectedId) {
      accountSelect.value = String(selectedId);
    } else if (accounts[0]) {
      accountSelect.value = String(accounts[0].id);
    }
  }

  function showFormulaPreview() {
    const formulaInput = document.getElementById('editTxnFormula');
    const preview = document.getElementById('editTxnFormulaPreview');
    if (!formulaInput || !preview) {
      return { valid: false, value: 0 };
    }

    const result = evaluateFormula(formulaInput.value);
    preview.textContent = result.text;
    preview.classList.remove('valid', 'invalid');
    preview.classList.add(result.valid ? 'valid' : 'invalid');
    return result;
  }

  function openTransactionModal(mode, transactionId) {
    const modal = document.getElementById('txnEditModal');
    const titleEl = document.getElementById('txnEditTitle');
    const typeInput = document.getElementById('editTxnType');
    const accountSelect = document.getElementById('editTxnAccount');
    const titleInput = document.getElementById('editTxnTitle');
    const formulaInput = document.getElementById('editTxnFormula');
    const merchantInput = document.getElementById('editTxnMerchant');
    const dateInput = document.getElementById('editTxnDate');
    const categorySelect = document.getElementById('editTxnCategory');
    const excludeInput = document.getElementById('editTxnExclude');
    const deleteBtn = document.getElementById('editTxnDelete');

    if (!modal || !titleEl || !typeInput || !accountSelect || !titleInput || !formulaInput || !merchantInput || !dateInput || !categorySelect || !excludeInput || !deleteBtn) {
      return;
    }

    transactionMode = mode;
    editingTransaction = null;

    if (mode === 'add') {
      titleEl.textContent = 'Add Transaction';
      deleteBtn.style.visibility = 'hidden';
      typeInput.value = 'expense';
      fillAccountSelect(null);
      fillCategorySelect('expense', null);
      titleInput.value = '';
      formulaInput.value = '';
      merchantInput.value = '';
      dateInput.value = new Date().toISOString().slice(0, 10);
      excludeInput.checked = false;
      showFormulaPreview();
    } else {
      const tx = db.queryValue(
        `SELECT t.*
         FROM transactions t
         WHERE t.id = ? AND t.user_id = ?
         LIMIT 1;`,
        [transactionId, activeUser.id]
      );
      if (!tx) {
        return;
      }

      editingTransaction = tx;
      titleEl.textContent = 'Edit Transaction';
      deleteBtn.style.visibility = 'visible';

      typeInput.value = tx.type;
      fillAccountSelect(tx.account_id);
      fillCategorySelect(tx.type, tx.category_id);

      titleInput.value = tx.title || '';
      formulaInput.value = tx.amount_formula || (tx.type === 'expense' ? `-${tx.amount}` : `${tx.amount}`);
      merchantInput.value = tx.merchant || '';
      dateInput.value = toInputDate(tx.date);

      const excludedSet = getExcludedSet();
      excludeInput.checked = excludedSet.has(Number(tx.id));
      showFormulaPreview();
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeTransactionModal() {
    const modal = document.getElementById('txnEditModal');
    if (!modal) {
      return;
    }

    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    editingTransaction = null;
  }

  function getCalendarEvents(transactions) {
    return transactions.map((txn) => {
      const isIncome = txn.type === 'income';
      const sign = isIncome ? '+' : '-';
      return {
        id: String(txn.id),
        start: String(txn.date).slice(0, 10),
        allDay: true,
        title: `${sign}${money(txn.amount)} · ${txn.title || 'Transaction'}`,
        backgroundColor: isIncome ? '#1f9f6e' : '#d63242',
        borderColor: isIncome ? '#1f9f6e' : '#d63242',
        extendedProps: {
          txnId: Number(txn.id)
        }
      };
    });
  }

  function syncHomeCalendar(transactions) {
    const calendarEl = document.getElementById('homeCalendar');
    if (!calendarEl || !window.FullCalendar) {
      return;
    }

    const events = getCalendarEvents(transactions);

    if (!homeCalendar) {
      homeCalendar = new window.FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        height: 'auto',
        headerToolbar: {
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay,multiMonthYear'
        },
        buttonText: {
          today: 'Today',
          dayGridMonth: 'Month',
          timeGridWeek: 'Week',
          timeGridDay: 'Day',
          multiMonthYear: 'Year'
        },
        dayMaxEventRows: 3,
        events,
        dateClick: function (info) {
          openTransactionModal('add');
          const dateInput = document.getElementById('editTxnDate');
          if (dateInput) {
            dateInput.value = String(info.dateStr).slice(0, 10);
          }
        },
        eventClick: function (info) {
          const txnId = Number(info.event.extendedProps.txnId || info.event.id);
          if (txnId) {
            openTransactionModal('edit', txnId);
          }
        }
      });

      homeCalendar.render();
      return;
    }

    homeCalendar.batchRendering(() => {
      const existingEvents = homeCalendar.getEvents();
      const existingIds = new Set(existingEvents.map(e => e.id));
      const newIds = new Set(events.map(e => e.id));

      // Remove events no longer present
      existingEvents.forEach(e => {
        if (!newIds.has(e.id)) {
          e.remove();
        }
      });

      // Add or Update
      events.forEach(eventObj => {
        const existing = homeCalendar.getEventById(eventObj.id);
        if (!existing) {
          homeCalendar.addEvent(eventObj);
        } else {
          // Optional: Only update if changed (title/amount/date)
          if (existing.title !== eventObj.title || existing.startStr !== eventObj.start) {
            existing.remove();
            homeCalendar.addEvent(eventObj);
          }
        }
      });
    });
  }

  function saveTransaction() {
    const typeInput = document.getElementById('editTxnType');
    const accountSelect = document.getElementById('editTxnAccount');
    const titleInput = document.getElementById('editTxnTitle');
    const formulaInput = document.getElementById('editTxnFormula');
    const merchantInput = document.getElementById('editTxnMerchant');
    const dateInput = document.getElementById('editTxnDate');
    const categorySelect = document.getElementById('editTxnCategory');
    const excludeInput = document.getElementById('editTxnExclude');

    if (!typeInput || !accountSelect || !titleInput || !formulaInput || !merchantInput || !dateInput || !categorySelect || !excludeInput) {
      return;
    }

    const formula = formulaInput.value.trim();
    const formulaResult = evaluateFormula(formula);
    if (!formulaResult.valid) {
      showFormulaPreview();
      return;
    }

    const type = typeInput.value === 'income' ? 'income' : 'expense';
    const amount = Math.abs(Number(formulaResult.value));

    if (!titleInput.value.trim() || !dateInput.value || !accountSelect.value || amount <= 0) {
      return;
    }

    const payload = {
      account_id: Number(accountSelect.value),
      category_id: categorySelect.value ? Number(categorySelect.value) : null,
      title: titleInput.value.trim(),
      amount,
      amount_formula: formula,
      merchant: merchantInput.value.trim(),
      type,
      date: dateInput.value
    };

    if (!ensureTransactionWillNotOverdraw(payload, transactionMode === 'edit' ? editingTransaction : null)) {
      window.alert('This transaction would make the selected account negative. Please use an amount within the available balance.');
      return;
    }

    if (transactionMode === 'add') {
      const created = db.createTransaction({
        user_id: activeUser.id,
        ...payload
      });

      const excluded = getExcludedSet();
      if (excludeInput.checked && created && created.id) {
        excluded.add(Number(created.id));
      }
      saveExcludedSet(excluded);
    } else if (editingTransaction) {
      db.updateTransaction(editingTransaction.id, payload);

      const excluded = getExcludedSet();
      if (excludeInput.checked) {
        excluded.add(Number(editingTransaction.id));
      } else {
        excluded.delete(Number(editingTransaction.id));
      }
      saveExcludedSet(excluded);
    }

    closeTransactionModal();
    renderHome();
  }

  function deleteTransaction() {
    if (!editingTransaction) {
      return;
    }

    const approved = window.confirm('Do you really want to remove this transaction?');
    if (!approved) {
      return;
    }

    db.deleteTransaction(editingTransaction.id);

    const excluded = getExcludedSet();
    excluded.delete(Number(editingTransaction.id));
    saveExcludedSet(excluded);

    closeTransactionModal();
    renderHome();
  }

  function openAccountModal(mode, accountId) {
    const modal = document.getElementById('accountModal');
    const title = document.getElementById('accountModalTitle');
    const nameInput = document.getElementById('accountNameInput');
    const balanceInput = document.getElementById('accountBalanceInput');
    const adjustInput = document.getElementById('accountAdjustInput');
    const remarksInput = document.getElementById('accountRemarksInput');
    const removeBtn = document.getElementById('accountRemove');

    if (!modal || !title || !nameInput || !balanceInput || !adjustInput || !remarksInput || !removeBtn) {
      return;
    }

    currentAccountMode = mode;
    currentAccount = null;
    pendingAccountTxns = [];

    if (mode === 'create') {
      title.textContent = 'Add Account';
      nameInput.value = '';
      balanceInput.value = '';
      adjustInput.value = '';
      remarksInput.value = '';
      removeBtn.style.visibility = 'hidden';
    } else {
      const account = db.queryValue(
        'SELECT * FROM accounts WHERE id = ? AND user_id = ? LIMIT 1;',
        [accountId, activeUser.id]
      );
      if (!account) {
        return;
      }
      currentAccount = account;
      title.textContent = 'Manage Account';
      nameInput.value = account.name;
      balanceInput.value = String(Number(account.balance || 0));
      adjustInput.value = '';
      remarksInput.value = '';
      removeBtn.style.visibility = 'visible';
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeAccountModal() {
    const modal = document.getElementById('accountModal');
    if (!modal) {
      return;
    }
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    currentAccount = null;
    pendingAccountTxns = [];
  }

  function adjustAccountBalance(direction) {
    const balanceInput = document.getElementById('accountBalanceInput');
    const adjustInput = document.getElementById('accountAdjustInput');
    const remarksInput = document.getElementById('accountRemarksInput');

    if (!balanceInput || !adjustInput) {
      return;
    }

    const current = Number(balanceInput.value || 0);
    const adjust = Math.abs(Number(adjustInput.value || 0));
    const remarks = remarksInput ? remarksInput.value.trim() : '';

    if (!Number.isFinite(adjust) || adjust <= 0) {
      return;
    }

    const next = direction === 'add' ? current + adjust : current - adjust;
    if (next < 0) {
      window.alert('You cannot deduct more than the available account balance.');
      return;
    }
    balanceInput.value = String(next);
    
    pendingAccountTxns.push({
      type: direction,
      amount: adjust,
      remarks: remarks,
      date: new Date().toISOString()
    });

    adjustInput.value = '';
    if (remarksInput) remarksInput.value = '';
  }

  function saveAccount() {
    const nameInput = document.getElementById('accountNameInput');
    const balanceInput = document.getElementById('accountBalanceInput');
    if (!nameInput || !balanceInput) {
      return;
    }

    const name = nameInput.value.trim();
    const balance = Number(balanceInput.value || 0);
    if (!name || !Number.isFinite(balance) || balance < 0) {
      if (Number.isFinite(balance) && balance < 0) {
        window.alert('Account balance cannot be negative.');
      }
      return;
    }

    let savedAccount = null;

    if (currentAccountMode === 'create') {
      savedAccount = db.createAccount({
        user_id: activeUser.id,
        name,
        type: 'bank',
        balance
      });
    } else if (currentAccount) {
      savedAccount = db.updateAccount(currentAccount.id, {
        name,
        balance,
        // Preserve existing type if any
        type: currentAccount.type
      });
    }

    if (savedAccount && pendingAccountTxns.length > 0) {
      for (const txn of pendingAccountTxns) {
        db.createTransaction({
          user_id: activeUser.id,
          account_id: savedAccount.id,
          title: txn.remarks || (txn.type === 'add' ? 'Manual Deposit' : 'Manual Withdrawal'),
          amount: txn.amount,
          type: txn.type === 'add' ? 'income' : 'expense',
          date: txn.date,
          merchant: 'Account Adjustment'
        });
      }
      // Force the balance back to what the user entered, 
      // ensuring the manual entry overrides the transaction delta logic
      db.updateAccount(savedAccount.id, { balance });
    }

    closeAccountModal();
    renderHome();
  }

  function removeAccount() {
    if (!currentAccount) {
      return;
    }

    const approved = window.confirm('Do you really want to remove this account?');
    if (!approved) {
      return;
    }

    db.deleteAccount(currentAccount.id);
    closeAccountModal();
    renderHome();
  }

  function fillPeopleAccountSelect(selectedId) {
    const select = document.getElementById('peopleAccountSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">(None - No Transaction)</option>';
    const accounts = db.listAccounts(activeUser.id);
    
    accounts.forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = acc.name;
      if (selectedId && String(acc.id) === String(selectedId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function openPeopleModal(mode, listType, itemId) {
    const modal = document.getElementById('peopleModal');
    const title = document.getElementById('peopleModalTitle');
    const nameInput = document.getElementById('peopleNameInput');
    const amountInput = document.getElementById('peopleAmountInput');
    const adjustInput = document.getElementById('peopleAdjustInput');
    const remarksInput = document.getElementById('peopleRemarksInput');
    const removeBtn = document.getElementById('peopleRemove');

    if (!modal || !title || !nameInput || !amountInput || !adjustInput || !remarksInput || !removeBtn) {
      return;
    }

    currentPeopleListType = listType;
    currentPeopleMode = mode;
    currentPeopleItem = null;
    pendingPeopleTxns = [];
    fillPeopleAccountSelect(null);

    const titlePrefix = listType === 'iowe' ? 'Money I Owe To' : 'Money People Owe';

    if (mode === 'create') {
      title.textContent = `Add: ${titlePrefix}`;
      nameInput.value = '';
      amountInput.value = '';
      adjustInput.value = '';
      remarksInput.value = '';
      removeBtn.style.visibility = 'hidden';
    } else {
      const rows = getPeopleByType(listType);
      const found = rows.find((row) => Number(row.id) === Number(itemId));
      if (!found) {
        return;
      }

      currentPeopleItem = found;
      title.textContent = `Manage: ${titlePrefix}`;
      nameInput.value = found.name;
      amountInput.value = String(Number(found.amount || 0));
      adjustInput.value = '';
      remarksInput.value = '';
      removeBtn.style.visibility = 'visible';
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closePeopleModal() {
    const modal = document.getElementById('peopleModal');
    if (!modal) {
      return;
    }
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    currentPeopleItem = null;
    pendingPeopleTxns = [];
  }

  function adjustPeopleAmount(direction) {
    const nameInput = document.getElementById('peopleNameInput');
    const amountInput = document.getElementById('peopleAmountInput');
    const adjustInput = document.getElementById('peopleAdjustInput');
    const remarksInput = document.getElementById('peopleRemarksInput');
    const accountSelect = document.getElementById('peopleAccountSelect');

    if (!amountInput || !adjustInput) {
      return;
    }

    const current = Number(amountInput.value || 0);
    const adjust = Math.abs(Number(adjustInput.value || 0));
    const remarks = remarksInput ? remarksInput.value.trim() : '';

    if (!Number.isFinite(adjust) || adjust <= 0) {
      return;
    }

    const accountId = Number(accountSelect ? accountSelect.value : 0);
    if (!accountId) {
      window.alert('Please choose an account so this adjustment is reflected in your balance.');
      return;
    }

    let txnType = 'expense';
    if (currentPeopleListType === 'owe') {
      txnType = direction === 'add' ? 'expense' : 'income';
    } else {
      txnType = direction === 'add' ? 'income' : 'expense';
    }

    // Safeguard for "Money I Owe" (iowe)
    if (currentPeopleListType === 'iowe' && direction === 'deduct' && adjust > current) {
      window.alert(`Safequard: You cannot pay more than what you owe (${money(current)}).`);
      return;
    }

    if (txnType === 'expense') {
      const projected = projectedAccountBalance(accountId, pendingPeopleTxns);
      if (projected === null || projected < adjust) {
        window.alert('This deduction is higher than your selected account balance.');
        return;
      }
    }

    let next = direction === 'add' ? current + adjust : current - adjust;
    
    // Auto-reset to 0 if they paid more than owed (for "People Owe Me")
    if (next < 0) {
      next = 0;
    }

    amountInput.value = String(next);
    adjustInput.value = '';
    if (remarksInput) {
      remarksInput.value = '';
    }

    pendingPeopleTxns.push({
      accountId,
      amount: adjust,
      type: txnType,
      remarks,
      date: new Date().toISOString()
    });
  }

  function savePeopleEntry() {
    const nameInput = document.getElementById('peopleNameInput');
    const amountInput = document.getElementById('peopleAmountInput');
    if (!nameInput || !amountInput) {
      return;
    }

    const name = nameInput.value.trim();
    const amount = Number(amountInput.value || 0);
    if (!name || !Number.isFinite(amount)) {
      return;
    }

    const originalAmount = currentPeopleMode === 'create'
      ? 0
      : Number((currentPeopleItem && currentPeopleItem.amount) || 0);
    const amountChangedManually = Math.abs(amount - originalAmount) > 0.009;
    if (amountChangedManually && pendingPeopleTxns.length === 0) {
      window.alert('Use Add Amount or Deduct Amount and choose an account so balances stay synchronized.');
      return;
    }

    const rows = getPeopleByType(currentPeopleListType);

    if (currentPeopleMode === 'create') {
      rows.push({
        id: nextPeopleId(currentPeopleListType),
        name,
        amount
      });
    } else if (currentPeopleItem) {
      const idx = rows.findIndex((item) => Number(item.id) === Number(currentPeopleItem.id));
      if (idx >= 0) {
        rows[idx] = {
          id: currentPeopleItem.id,
          name,
          amount
        };
      }
    }

    // Process Pending Transactions
    if (pendingPeopleTxns.length > 0) {
      for (const txn of pendingPeopleTxns) {
        if (txn.type === 'expense') {
          const account = getAccountForUser(txn.accountId);
          if (!account || Number(account.balance || 0) < Number(txn.amount || 0)) {
            window.alert('One of your selected accounts no longer has enough balance. Please try again.');
            return;
          }
        }

        db.createTransaction({
          user_id: activeUser.id,
          account_id: txn.accountId,
          title: txn.remarks || (currentPeopleListType === 'owe' 
             ? (txn.type === 'expense' ? 'Lent Money' : 'Repayment Received')
             : (txn.type === 'income' ? 'Borrowed Money' : 'Debt Payment')),
          amount: txn.amount,
          type: txn.type,
          merchant: name, // Person name as merchant
          date: txn.date
        });
      }
    }

    savePeopleByType(currentPeopleListType, rows);
    closePeopleModal();
    renderHome();
  }

  function removePeopleEntry() {
    if (!currentPeopleItem) {
      return;
    }

    const approved = window.confirm('Do you really want to remove this entry?');
    if (!approved) {
      return;
    }

    const rows = getPeopleByType(currentPeopleListType).filter((item) => Number(item.id) !== Number(currentPeopleItem.id));
    savePeopleByType(currentPeopleListType, rows);
    closePeopleModal();
    renderHome();
  }

  function renderHome() {
    const txContainer = document.getElementById('homeTransactions');
    const accountsContainer = document.getElementById('homeAccounts');
    const oweContainer = document.getElementById('homePeopleOwe');
    const iOweContainer = document.getElementById('homePeopleIOwe');
    const worthValue = document.getElementById('netWorthValue');
    const worthSubtext = document.getElementById('netWorthSubtext');
    const goalProgressLabel = document.getElementById('goalProgressLabel');
    const goalProgressFill = document.getElementById('goalProgressFill');
    const goalProgressMeta = document.getElementById('goalProgressMeta');
    const accountsTotalValue = document.getElementById('accountsTotalValue');
    const peopleOweTotalValue = document.getElementById('peopleOweTotalValue');
    const peopleIOweTotalValue = document.getElementById('peopleIOweTotalValue');

    const owedOffBtn = document.getElementById('toggleOwedOff');
    const owedOnBtn = document.getElementById('toggleOwedOn');

    if (!txContainer || !accountsContainer || !oweContainer || !iOweContainer || !worthValue || !worthSubtext) {
      return;
    }

    const excludedSet = getExcludedSet();
    const allTransactions = db.listTransactions(activeUser.id).filter((txn) => !excludedSet.has(Number(txn.id)));
    const transactions = allTransactions.slice(0, homeTxLimit);
    const accounts = db.listAccounts(activeUser.id);

    const showMoreBtn = document.getElementById('showMoreTxBtn');
    if (showMoreBtn) {
      showMoreBtn.style.display = allTransactions.length > homeTxLimit ? 'block' : 'none';
    }

    const peopleOweRows = getPeopleByType('owe');
    const peopleIOweRows = getPeopleByType('iowe');

    const accountsTotal = accounts.reduce((sum, item) => sum + Number(item.balance || 0), 0);
    const peopleOweTotal = peopleOweRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const peopleIOweTotal = peopleIOweRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const include = includeOwed();
    const netWorth = include
      ? (accountsTotal + peopleOweTotal - peopleIOweTotal)
      : accountsTotal;

    if (lastRenderedNetWorth !== null) {
      launchNetWorthMood(netWorth - lastRenderedNetWorth);
    }
    lastRenderedNetWorth = netWorth;

    if (accountsTotalValue) {
      accountsTotalValue.textContent = money(accountsTotal);
    }
    if (peopleOweTotalValue) {
      peopleOweTotalValue.textContent = money(peopleOweTotal);
    }
    if (peopleIOweTotalValue) {
      peopleIOweTotalValue.textContent = money(peopleIOweTotal);
    }

    worthValue.textContent = money(netWorth);
    worthValue.classList.toggle('negative', netWorth < 0);
    worthValue.classList.toggle('positive', netWorth >= 0);

    if (include) {
      worthSubtext.textContent = `Accounts ${money(accountsTotal)} + Owed to you ${money(peopleOweTotal)} - You owe ${money(peopleIOweTotal)}`;
    } else {
      worthSubtext.textContent = `Accounts only: ${money(accountsTotal)} (Owed lists are off)`;
    }

    if (owedOffBtn && owedOnBtn) {
      owedOffBtn.classList.toggle('active', !include);
      owedOnBtn.classList.toggle('active', include);
    }

    if (goalProgressLabel && goalProgressFill && goalProgressMeta) {
      const savedGoal = getWeeklyForecastGoal();
      if (!savedGoal || !Number.isFinite(Number(savedGoal.target))) {
        goalProgressLabel.textContent = 'Goal Progress: No saved forecast goal yet.';
        goalProgressMeta.textContent = 'Save a goal in Monthly Overview to track it here.';
        goalProgressFill.style.width = '0%';
      } else {
        const target = Number(savedGoal.target);
        let percent = 0;

        if (target <= 0) {
          percent = netWorth >= target ? 100 : 0;
        } else {
          percent = (netWorth / target) * 100;
        }

        const clamped = Math.max(0, Math.min(100, percent));
        goalProgressFill.style.width = `${clamped.toFixed(1)}%`;

        goalProgressLabel.textContent = `Goal Progress: ${clamped.toFixed(1)}%`;
        goalProgressMeta.textContent = `${money(netWorth)} of ${money(target)} target (${savedGoal.presetLabel || 'Custom'}, ${savedGoal.weeks || 0} weeks)`;
      }
    }

    syncHomeCalendar(allTransactions);

    if (transactions.length === 0) {
      txContainer.innerHTML = '<p class="empty-copy">No transactions yet.</p>';
    } else {
      txContainer.innerHTML = transactions.map((txn) => {
        const amountClass = txn.type === 'income' ? 'positive' : 'negative';
        const amountPrefix = txn.type === 'income' ? '+' : '-';
        const formulaHint = txn.amount_formula ? ` · ${txn.amount_formula}` : '';

        return `
          <h3 class="tx-day">${escapeHtml(fmtDate(txn.date))}</h3>
          <div class="tx-item" data-txn-id="${txn.id}" title="Click to edit transaction">
            <div class="tx-left">
              <div class="tx-avatar">${escapeHtml(initials(txn.title))}</div>
              <div>
                <p class="tx-title">${escapeHtml(txn.title)}</p>
                <p class="tx-sub">${escapeHtml((txn.merchant || txn.account_name || 'Unknown source') + formulaHint)}</p>
              </div>
            </div>
            <div class="tx-right">
              <p class="tx-amount ${amountClass}">${amountPrefix}${escapeHtml(money(txn.amount))}</p>
              <span class="tx-tag">${escapeHtml((txn.category_name || txn.type).toUpperCase())}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    if (accounts.length === 0) {
      accountsContainer.innerHTML = '<p class="empty-copy">No accounts found.</p>';
    } else {
      accountsContainer.innerHTML = accounts.map((account) => {
        return `
          <div class="account-row" data-account-id="${account.id}" title="Click to manage account">
            <p class="account-name"><span class="account-icon">${escapeHtml(initials(account.name))}</span>${escapeHtml(account.name)}</p>
            <p class="account-value positive">${escapeHtml(money(account.balance))}</p>
          </div>
        `;
      }).join('');
    }

    if (peopleOweRows.length === 0) {
      oweContainer.innerHTML = '<p class="empty-copy">No entries yet.</p>';
    } else {
      oweContainer.innerHTML = peopleOweRows.map((row) => {
        const isPaid = Number(row.amount) <= 0;
        const valText = isPaid ? 'PAID' : money(row.amount);
        const valClass = isPaid ? 'paid' : 'positive';
        return `
          <div class="owe-row" data-list-type="owe" data-people-id="${row.id}" title="Click to manage entry">
            <p class="owe-name"><span class="account-icon">${escapeHtml(initials(row.name))}</span>${escapeHtml(row.name)}</p>
            <p class="owe-value ${valClass}">${escapeHtml(valText)}</p>
          </div>
        `;
      }).join('');
    }

    if (peopleIOweRows.length === 0) {
      iOweContainer.innerHTML = '<p class="empty-copy">No entries yet.</p>';
    } else {
      iOweContainer.innerHTML = peopleIOweRows.map((row) => {
        const isPaid = Number(row.amount) <= 0;
        const valText = isPaid ? 'PAID' : money(row.amount);
        const valClass = isPaid ? 'paid' : 'negative';
        return `
          <div class="owe-row" data-list-type="iowe" data-people-id="${row.id}" title="Click to manage entry">
            <p class="owe-name"><span class="account-icon">${escapeHtml(initials(row.name))}</span>${escapeHtml(row.name)}</p>
            <p class="owe-value ${valClass}">${escapeHtml(valText)}</p>
          </div>
        `;
      }).join('');
    }

    fillAccountSelect(null);
  }

  function renderAllTransactions() {
    const tbody = document.getElementById('allTransactionsBody');
    const listWrap = document.getElementById('allTxListWrap');
    const tableWrap = document.getElementById('allTxTableWrap');
    const listContainer = document.getElementById('allTransactionsList');
    const resultCount = document.getElementById('allTxCount');

    if (!tbody) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const monthFilter = allTxState.month === 'this_month' ? currentMonthKey() : null;
    const yearFilter = allTxState.month === 'this_year' ? currentYearKey() : null;

    const excludedSet = getExcludedSet();
    const rows = db.listTransactions(activeUser.id)
      .filter((txn) => {
        if (monthFilter && String(txn.date).slice(0, 7) !== monthFilter) {
          return false;
        }
        if (yearFilter && String(txn.date).slice(0, 4) !== yearFilter) {
          return false;
        }
        if (!allTxState.includeFuture && String(txn.date).slice(0, 10) > today) {
          return false;
        }
        if (allTxState.type !== 'all' && txn.type !== allTxState.type) {
          return false;
        }
        if (allTxState.category !== 'all' && Number(txn.category_id) !== Number(allTxState.category)) {
          return false;
        }
        if (allTxState.search) {
          const haystack = [txn.title, txn.merchant, txn.category_name, txn.type]
            .map(normalizeLower)
            .join(' ');
          if (!haystack.includes(allTxState.search)) {
            return false;
          }
        }
        return true;
      });

    if (resultCount) {
      resultCount.textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`;
    }

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No transactions available.</td></tr>';
      if (listContainer) {
        listContainer.innerHTML = '<p class="empty-row">No transactions available.</p>';
      }
      if (tableWrap && listWrap) {
        tableWrap.classList.toggle('hidden', allTxState.view !== 'table');
        listWrap.classList.toggle('hidden', allTxState.view !== 'list');
      }
      return;
    }

    tbody.innerHTML = rows.map((txn) => {
      const isExcluded = excludedSet.has(Number(txn.id));
      const amountClass = isExcluded ? 'excluded' : (txn.type === 'income' ? 'positive' : 'negative');
      const amountPrefix = txn.type === 'income' ? '+' : '-';
      return `
        <tr>
          <td>${escapeHtml(fmtDate(txn.date))}</td>
          <td>${escapeHtml(txn.title || '-')}</td>
          <td>${escapeHtml(txn.merchant || '-')}</td>
          <td class="align-right ${amountClass}">${amountPrefix}${escapeHtml(money(txn.amount))}</td>
          <td>${escapeHtml(txn.category_name || categoryNameById(txn.category_id))}</td>
        </tr>
      `;
    }).join('');

    if (listContainer) {
      listContainer.innerHTML = rows.map((txn) => {
        const isExcluded = excludedSet.has(Number(txn.id));
        const amountClass = isExcluded ? 'excluded' : (txn.type === 'income' ? 'positive' : 'negative');
        const amountPrefix = txn.type === 'income' ? '+' : '-';
        return `
          <div class="txn-list-item">
            <span>${escapeHtml(fmtDate(txn.date))}</span>
            <span>${escapeHtml(txn.title || '-')}</span>
            <span>${escapeHtml(txn.merchant || '-')}</span>
            <span class="align-right ${amountClass}">${amountPrefix}${escapeHtml(money(txn.amount))}</span>
            <span>${escapeHtml(txn.category_name || categoryNameById(txn.category_id))}</span>
          </div>
        `;
      }).join('');
    }

    if (tableWrap && listWrap) {
      tableWrap.classList.toggle('hidden', allTxState.view !== 'table');
      listWrap.classList.toggle('hidden', allTxState.view !== 'list');
    }
  }

  function initAllTransactionsPage() {
    const searchInput = document.getElementById('allTxSearch');
    const monthSelect = document.getElementById('allTxMonth');
    const showFutureBtn = document.getElementById('showFutureBtn');
    const hideFutureBtn = document.getElementById('hideFutureBtn');
    const typeGroup = document.getElementById('allTxTypeGroup');
    const categorySelect = document.getElementById('allTxCategory');
    const viewGroup = document.getElementById('allTxViewGroup');
    const newBtn = document.getElementById('allTxNewBtn');

    if (!searchInput || !monthSelect || !showFutureBtn || !hideFutureBtn || !typeGroup || !categorySelect || !viewGroup || !newBtn) {
      return;
    }

    const categories = db.listCategories('all');
    categorySelect.innerHTML = ['<option value="all">All categories</option>']
      .concat(categories.map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`))
      .join('');

    function setActive(group, value, attrName) {
      Array.from(group.querySelectorAll('[data-' + attrName + ']')).forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-' + attrName) === value);
      });
    }

    searchInput.addEventListener('input', function () {
      allTxState.search = normalizeLower(searchInput.value.trim());
      renderAllTransactions();
    });

    monthSelect.addEventListener('change', function () {
      allTxState.month = monthSelect.value;
      renderAllTransactions();
    });

    showFutureBtn.addEventListener('click', function () {
      allTxState.includeFuture = true;
      showFutureBtn.classList.add('active');
      hideFutureBtn.classList.remove('active');
      renderAllTransactions();
    });

    hideFutureBtn.addEventListener('click', function () {
      allTxState.includeFuture = false;
      hideFutureBtn.classList.add('active');
      showFutureBtn.classList.remove('active');
      renderAllTransactions();
    });

    typeGroup.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-type]');
      if (!btn) {
        return;
      }
      allTxState.type = btn.getAttribute('data-type');
      setActive(typeGroup, allTxState.type, 'type');
      renderAllTransactions();
    });

    categorySelect.addEventListener('change', function () {
      allTxState.category = categorySelect.value;
      renderAllTransactions();
    });

    viewGroup.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-view]');
      if (!btn) {
        return;
      }
      allTxState.view = btn.getAttribute('data-view');
      setActive(viewGroup, allTxState.view, 'view');
      renderAllTransactions();
    });

    newBtn.addEventListener('click', function () {
      window.location.href = '../home.html?addTx=1';
    });

    renderAllTransactions();
  }

  function renderMonthlyOverview() {
    const incomeEl = document.getElementById('monthlyIncome');
    const expenseEl = document.getElementById('monthlyExpenses');
    const savingsRateEl = document.getElementById('monthlySavingsRate');
    const topCategoryEl = document.getElementById('monthlyTopCategory');

    if (!incomeEl || !expenseEl || !savingsRateEl || !topCategoryEl) {
      return;
    }

    const monthKey = selectedOverviewMonth();
    const txs = db.listTransactions(activeUser.id, { month: monthKey });

    const monthTitle = document.getElementById('monthlyBoardTitle');
    if (monthTitle) {
      const [year, month] = monthKey.split('-').map(Number);
      monthTitle.textContent = new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
        month: 'long',
        year: 'numeric'
      });
    }

    const totals = txs.reduce((acc, item) => {
      if (item.type === 'income') {
        acc.income += Number(item.amount || 0);
      }
      if (item.type === 'expense') {
        acc.expense += Number(item.amount || 0);
      }
      return acc;
    }, { income: 0, expense: 0 });

    incomeEl.textContent = money(totals.income);
    expenseEl.textContent = money(totals.expense);

    const savingsRate = totals.income > 0
      ? ((totals.income - totals.expense) / totals.income) * 100
      : 0;
    savingsRateEl.textContent = `${savingsRate.toFixed(1)}%`;

    const grouped = {};
    const expenseRows = txs.filter((item) => item.type === 'expense');
    expenseRows.forEach((item) => {
      const key = item.category_name || 'Uncategorized';
      grouped[key] = (grouped[key] || 0) + Number(item.amount || 0);
    });

    const top = Object.entries(grouped).sort((a, b) => b[1] - a[1])[0];
    topCategoryEl.textContent = top ? `${top[0]} (${money(top[1])})` : 'No expense data yet';

    const { end } = monthRange(monthKey);
    const today = new Date();
    let daysElapsed = end.getDate();
    if (sameMonth(today, monthKey)) {
      daysElapsed = Math.max(1, Math.min(end.getDate(), today.getDate()));
    }
    const paceFactor = end.getDate() / Math.max(1, daysElapsed);

    const expectedIncome = totals.income * paceFactor;
    const expectedExpense = totals.expense * paceFactor;

    renderMonthlyCategoryTable(expenseRows, paceFactor);
    renderWeeklySpending(monthKey, txs);
    renderMoneyInOut(expectedIncome, expectedExpense, totals.income, totals.expense);
    renderTopCategoriesChart(expenseRows);
    renderCumulativeChart(monthKey, expenseRows);
  }

  function getWeeklyForecastState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(userScopedKey(WEEKLY_FORECAST_KEY)) || '{}');
      return {
        startBalance: Number(parsed.startBalance) || 0,
        weeklyAllowance: Number(parsed.weeklyAllowance) || 0,
        weeklyExpenses: Number(parsed.weeklyExpenses) || 0,
        weeks: Math.max(1, Math.floor(Number(parsed.weeks) || 1)),
        riskPercent: Math.max(0, Number(parsed.riskPercent) || 0),
        extraWeekly: Math.max(0, Number(parsed.extraWeekly) || 0)
      };
    } catch (error) {
      return {
        startBalance: 0,
        weeklyAllowance: 0,
        weeklyExpenses: 0,
        weeks: 1,
        riskPercent: 0,
        extraWeekly: 0
      };
    }
  }

  function setWeeklyForecastState(state) {
    localStorage.setItem(userScopedKey(WEEKLY_FORECAST_KEY), JSON.stringify(state));
  }

  function getWeeklyForecastGoal() {
    try {
      return JSON.parse(localStorage.getItem(userScopedKey(WEEKLY_FORECAST_GOAL_KEY)) || 'null');
    } catch (_error) {
      return null;
    }
  }

  function setWeeklyForecastGoal(goal) {
    localStorage.setItem(userScopedKey(WEEKLY_FORECAST_GOAL_KEY), JSON.stringify(goal));
  }

  function initWeeklyForecast() {
    const startDateEl = document.getElementById('forecastStartDate');
    const startBalanceInput = document.getElementById('forecastStartBalance');
    const weeklyAllowanceInput = document.getElementById('forecastWeeklyAllowance');
    const weeklyExpensesInput = document.getElementById('forecastWeeklyExpenses');
    const weeksInput = document.getElementById('forecastWeeks');
    const riskPercentInput = document.getElementById('forecastRiskPercent');
    const extraWeeklyInput = document.getElementById('forecastExtraWeekly');
    const useCurrentBtn = document.getElementById('forecastUseCurrentBalance');
    const saveGoalBtn = document.getElementById('forecastSaveGoal');
    const presetGroup = document.getElementById('forecastPresetGroup');
    const goalText = document.getElementById('forecastGoalText');

    const inflowEl = document.getElementById('forecastInflowTotal');
    const plannedOutflowEl = document.getElementById('forecastPlannedOutflow');
    const riskOutflowEl = document.getElementById('forecastRiskOutflow');
    const projectedEl = document.getElementById('forecastProjected');
    const conservativeEl = document.getElementById('forecastConservative');
    const weeklySafeEl = document.getElementById('forecastWeeklySafe');

    if (
      !startDateEl || !startBalanceInput || !weeklyAllowanceInput || !weeklyExpensesInput ||
      !weeksInput || !riskPercentInput || !extraWeeklyInput || !useCurrentBtn || !saveGoalBtn || !presetGroup || !goalText ||
      !inflowEl || !plannedOutflowEl || !riskOutflowEl || !projectedEl || !conservativeEl || !weeklySafeEl
    ) {
      return;
    }

    const today = new Date().toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    startDateEl.textContent = `Starting today: ${today}`;

    const accountTotal = db.listAccounts(activeUser.id).reduce((sum, account) => {
      return sum + Number(account.balance || 0);
    }, 0);

    const saved = getWeeklyForecastState();
    const initialState = {
      ...saved,
      startBalance: saved.startBalance > 0 ? saved.startBalance : accountTotal
    };

    startBalanceInput.value = String(initialState.startBalance);
    weeklyAllowanceInput.value = String(initialState.weeklyAllowance);
    weeklyExpensesInput.value = String(initialState.weeklyExpenses);
    weeksInput.value = String(initialState.weeks);
    riskPercentInput.value = String(initialState.riskPercent);
    extraWeeklyInput.value = String(initialState.extraWeekly);

    const savedGoal = getWeeklyForecastGoal();
    if (savedGoal) {
      goalText.textContent = `${savedGoal.savedAt}: ${savedGoal.weeks} weeks target = ${money(savedGoal.target)} (${savedGoal.presetLabel})`;
    }

    function setPreset(preset) {
      const map = {
        best: { riskPercent: 0, extraWeekly: 0 },
        normal: { riskPercent: 10, extraWeekly: 0 },
        worst: { riskPercent: 25, extraWeekly: 100 }
      };
      const selected = map[preset] || map.normal;
      riskPercentInput.value = String(selected.riskPercent);
      extraWeeklyInput.value = String(selected.extraWeekly);

      Array.from(presetGroup.querySelectorAll('[data-preset]')).forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-preset') === preset);
      });
    }

    function activePresetLabel() {
      const active = presetGroup.querySelector('[data-preset].active');
      if (!active) {
        return 'Custom';
      }
      const value = active.getAttribute('data-preset');
      if (value === 'best') return 'Best Case';
      if (value === 'worst') return 'Worst Case';
      return 'Normal';
    }

    function recalc() {
      const state = {
        startBalance: Number(startBalanceInput.value || 0),
        weeklyAllowance: Math.max(0, Number(weeklyAllowanceInput.value || 0)),
        weeklyExpenses: Math.max(0, Number(weeklyExpensesInput.value || 0)),
        weeks: Math.max(1, Math.floor(Number(weeksInput.value || 1))),
        riskPercent: Math.max(0, Number(riskPercentInput.value || 0)),
        extraWeekly: Math.max(0, Number(extraWeeklyInput.value || 0))
      };

      setWeeklyForecastState(state);

      const totalInflow = state.weeklyAllowance * state.weeks;
      const plannedOutflow = state.weeklyExpenses * state.weeks;
      const riskOutflow = ((state.weeklyExpenses * state.riskPercent) / 100 + state.extraWeekly) * state.weeks;

      const projected = state.startBalance + totalInflow - plannedOutflow;
      const conservative = state.startBalance + totalInflow - plannedOutflow - riskOutflow;
      const weeklySafe = state.weeklyAllowance - state.weeklyExpenses - ((state.weeklyExpenses * state.riskPercent) / 100 + state.extraWeekly);

      inflowEl.textContent = money(totalInflow);
      plannedOutflowEl.textContent = money(plannedOutflow);
      riskOutflowEl.textContent = money(riskOutflow);
      projectedEl.textContent = money(projected);
      conservativeEl.textContent = money(conservative);
      weeklySafeEl.textContent = money(weeklySafe);

      projectedEl.classList.toggle('negative', projected < 0);
      projectedEl.classList.toggle('positive', projected >= 0);
      conservativeEl.classList.toggle('negative', conservative < 0);
      conservativeEl.classList.toggle('positive', conservative >= 0);
      weeklySafeEl.classList.toggle('negative', weeklySafe < 0);
      weeklySafeEl.classList.toggle('positive', weeklySafe >= 0);
    }

    [
      startBalanceInput,
      weeklyAllowanceInput,
      weeklyExpensesInput,
      weeksInput,
      riskPercentInput,
      extraWeeklyInput
    ].forEach((input) => {
      input.addEventListener('input', recalc);
    });

    useCurrentBtn.addEventListener('click', function () {
      startBalanceInput.value = String(accountTotal);
      recalc();
    });

    presetGroup.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-preset]');
      if (!btn) {
        return;
      }
      setPreset(btn.getAttribute('data-preset'));
      recalc();
    });

    saveGoalBtn.addEventListener('click', function () {
      const state = {
        startBalance: Number(startBalanceInput.value || 0),
        weeklyAllowance: Math.max(0, Number(weeklyAllowanceInput.value || 0)),
        weeklyExpenses: Math.max(0, Number(weeklyExpensesInput.value || 0)),
        weeks: Math.max(1, Math.floor(Number(weeksInput.value || 1))),
        riskPercent: Math.max(0, Number(riskPercentInput.value || 0)),
        extraWeekly: Math.max(0, Number(extraWeeklyInput.value || 0))
      };
      const totalInflow = state.weeklyAllowance * state.weeks;
      const plannedOutflow = state.weeklyExpenses * state.weeks;
      const riskOutflow = ((state.weeklyExpenses * state.riskPercent) / 100 + state.extraWeekly) * state.weeks;
      const conservative = state.startBalance + totalInflow - plannedOutflow - riskOutflow;

      const savedAt = new Date().toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      const goal = {
        target: conservative,
        weeks: state.weeks,
        presetLabel: activePresetLabel(),
        savedAt
      };

      setWeeklyForecastGoal(goal);
      goalText.textContent = `${goal.savedAt}: ${goal.weeks} weeks target = ${money(goal.target)} (${goal.presetLabel})`;
    });

    recalc();
  }

  function initMonthlyOverviewPage() {
    const monthSelect = document.getElementById('monthlyBoardMonth');
    if (monthSelect) {
      const today = new Date();
      const options = [];
      for (let i = -6; i <= 6; i += 1) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
        options.push(`<option value="${ym}">${escapeHtml(label)}</option>`);
      }
      monthSelect.innerHTML = options.join('');

      const saved = localStorage.getItem(MONTHLY_OVERVIEW_MONTH_KEY) || currentMonthKey();
      monthSelect.value = saved;
      monthSelect.addEventListener('change', function () {
        localStorage.setItem(MONTHLY_OVERVIEW_MONTH_KEY, monthSelect.value);
        renderMonthlyOverview();
      });
    }

    renderMonthlyOverview();
    initWeeklyForecast();
  }

  function renderHistory() {
    const list = document.getElementById('historyList');
    if (!list) {
      return;
    }

    const rows = db.query(
      `SELECT
         strftime('%Y-%m', date) AS ym,
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ?
       GROUP BY ym
       ORDER BY ym DESC
       LIMIT 12;`,
      [activeUser.id]
    );

    if (rows.length === 0) {
      list.innerHTML = '<li><span>No monthly snapshots yet</span><strong>₱0.00</strong></li>';
      return;
    }

    list.innerHTML = rows.map((row) => {
      const [year, month] = row.ym.split('-');
      const stamp = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-PH', {
        month: 'long',
        year: 'numeric'
      });
      const net = Number(row.income) - Number(row.expense);
      return `<li><span>${escapeHtml(stamp)} Snapshot</span><strong>${escapeHtml(money(net))}</strong></li>`;
    }).join('');
  }

  function attachHomeInteractions() {
    const txContainer = document.getElementById('homeTransactions');
    const accountsContainer = document.getElementById('homeAccounts');
    const oweContainer = document.getElementById('homePeopleOwe');
    const iOweContainer = document.getElementById('homePeopleIOwe');

    const addTransactionBtn = document.getElementById('addTransactionBtn');
    const addAccountBtn = document.getElementById('addAccountBtn');
    const addPeopleOweBtn = document.getElementById('addPeopleOweBtn');
    const addPeopleIOweBtn = document.getElementById('addPeopleIOweBtn');

    const owedOffBtn = document.getElementById('toggleOwedOff');
    const owedOnBtn = document.getElementById('toggleOwedOn');

    const txnModal = document.getElementById('txnEditModal');
    const txnClose = document.getElementById('txnModalClose');
    const txnCancel = document.getElementById('editTxnCancel');
    const txnType = document.getElementById('editTxnType');
    const txnFormula = document.getElementById('editTxnFormula');
    const txnSave = document.getElementById('editTxnSave');
    const txnDelete = document.getElementById('editTxnDelete');

    const accountModal = document.getElementById('accountModal');
    const accountClose = document.getElementById('accountModalClose');
    const accountCancel = document.getElementById('accountCancel');
    const accountSave = document.getElementById('accountSave');
    const accountRemove = document.getElementById('accountRemove');
    const accountAddBalance = document.getElementById('accountAddBalance');
    const accountDeductBalance = document.getElementById('accountDeductBalance');

    const peopleModal = document.getElementById('peopleModal');
    const peopleClose = document.getElementById('peopleModalClose');
    const peopleCancel = document.getElementById('peopleCancel');
    const peopleSave = document.getElementById('peopleSave');
    const peopleRemove = document.getElementById('peopleRemove');
    const peopleAddAmount = document.getElementById('peopleAddAmount');
    const peopleDeductAmount = document.getElementById('peopleDeductAmount');

    if (!txContainer || !accountsContainer || !oweContainer || !iOweContainer || !txnModal || !accountModal || !peopleModal) {
      return;
    }

    txContainer.addEventListener('click', function (event) {
      const row = event.target.closest('.tx-item[data-txn-id]');
      if (!row) {
        return;
      }
      openTransactionModal('edit', Number(row.getAttribute('data-txn-id')));
    });

    accountsContainer.addEventListener('click', function (event) {
      const row = event.target.closest('.account-row[data-account-id]');
      if (!row) {
        return;
      }
      openAccountModal('edit', Number(row.getAttribute('data-account-id')));
    });

    function peopleClickHandler(event) {
      const row = event.target.closest('.owe-row[data-people-id]');
      if (!row) {
        return;
      }
      openPeopleModal('edit', String(row.getAttribute('data-list-type')), Number(row.getAttribute('data-people-id')));
    }

    oweContainer.addEventListener('click', peopleClickHandler);
    iOweContainer.addEventListener('click', peopleClickHandler);

    addTransactionBtn.addEventListener('click', function () {
      openTransactionModal('add');
    });

    addAccountBtn.addEventListener('click', function () {
      openAccountModal('create');
    });

    addPeopleOweBtn.addEventListener('click', function () {
      openPeopleModal('create', 'owe');
    });

    addPeopleIOweBtn.addEventListener('click', function () {
      openPeopleModal('create', 'iowe');
    });

    owedOffBtn.addEventListener('click', function () {
      setIncludeOwed(false);
      renderHome();
    });

    owedOnBtn.addEventListener('click', function () {
      setIncludeOwed(true);
      renderHome();
    });

    const showMoreBtn = document.getElementById('showMoreTxBtn');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', function() {
        homeTxLimit += 12;
        renderHome();
      });
    }

    txnClose.addEventListener('click', closeTransactionModal);
    txnCancel.addEventListener('click', closeTransactionModal);
    txnFormula.addEventListener('input', showFormulaPreview);
    txnType.addEventListener('change', function () {
      fillCategorySelect(txnType.value, null);
    });
    txnSave.addEventListener('click', saveTransaction);
    txnDelete.addEventListener('click', deleteTransaction);

    txnModal.addEventListener('click', function (event) {
      if (event.target === txnModal) {
        closeTransactionModal();
      }
    });

    accountClose.addEventListener('click', closeAccountModal);
    accountCancel.addEventListener('click', closeAccountModal);
    accountSave.addEventListener('click', saveAccount);
    accountRemove.addEventListener('click', removeAccount);
    accountAddBalance.addEventListener('click', function () {
      adjustAccountBalance('add');
    });
    accountDeductBalance.addEventListener('click', function () {
      adjustAccountBalance('deduct');
    });

    accountModal.addEventListener('click', function (event) {
      if (event.target === accountModal) {
        closeAccountModal();
      }
    });

    peopleClose.addEventListener('click', closePeopleModal);
    peopleCancel.addEventListener('click', closePeopleModal);
    peopleSave.addEventListener('click', savePeopleEntry);
    peopleRemove.addEventListener('click', removePeopleEntry);
    peopleAddAmount.addEventListener('click', function () {
      adjustPeopleAmount('add');
    });
    peopleDeductAmount.addEventListener('click', function () {
      adjustPeopleAmount('deduct');
    });

    peopleModal.addEventListener('click', function (event) {
      if (event.target === peopleModal) {
        closePeopleModal();
      }
    });
  }

  function attachAccountMeta() {
    const meta = document.querySelector('.nav-meta');
    if (!meta || !activeUser) {
      return;
    }

    const username = activeUser.username || activeUser.full_name || 'Account';
    meta.innerHTML = `
      <span class="account-pill-name">${escapeHtml(username)}</span>
      <button type="button" class="account-pill-logout" id="logoutBtn">Logout</button>
    `;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        localStorage.removeItem(ACTIVE_USER_KEY);
        window.location.href = authPagePath();
      });
    }
  }

  async function start() {
    if (typeof window.createBudgetDB !== 'function') {
      return;
    }

    ensureFreshStartForV2();
    db = await window.createBudgetDB({ schemaPath: schemaPathForPage() });
    const page = currentPage();

    activeUser = readActiveUser();
    if (!activeUser && page !== AUTH_PAGE) {
      window.location.href = authPagePath();
      return;
    }

    if (activeUser && page === AUTH_PAGE) {
      window.location.href = HOME_PAGE;
      return;
    }

    if (!activeUser) {
      return;
    }

    ensureUserDefaults();
    attachAccountMeta();

    if (page === HOME_PAGE) {
      renderHome();
      attachHomeInteractions();

      const params = new URLSearchParams(window.location.search);
      if (params.get('addTx') === '1') {
        openTransactionModal('add');
      }
    }
    if (page === 'all-transactions.html') {
      initAllTransactionsPage();
    }
    if (page === 'monthly-overview.html') {
      initMonthlyOverviewPage();
    }
    if (page === 'history.html') {
      renderHistory();
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    start().catch(function (error) {
      console.error('[BudgetWise] app bootstrap failed', error);
    });
  });
})();
