(function () {
  'use strict';

  const ACTIVE_USER_KEY = 'budgetwise_active_user_id';
  const EXCLUDED_TX_KEY = 'budgetwise_excluded_tx_ids';
  const PEOPLE_OWE_KEY = 'budgetwise_people_owe_v1';
  const PEOPLE_IOWE_KEY = 'budgetwise_people_iowe_v1';
  const INCLUDE_OWED_KEY = 'budgetwise_include_owed';
  const HOME_PAGE = 'home.html';

  let db = null;
  let activeUser = null;
  let editingTransaction = null;
  let transactionMode = 'edit';

  let currentAccountMode = 'create';
  let currentAccount = null;

  let currentPeopleListType = 'owe';
  let currentPeopleMode = 'create';
  let currentPeopleItem = null;

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

  function currentPage() {
    return window.location.pathname.split('/').pop() || HOME_PAGE;
  }

  function schemaPathForPage() {
    if (window.location.pathname.includes('/pages/')) {
      return '../schema.sql';
    }
    return 'schema.sql';
  }

  function includeOwed() {
    return localStorage.getItem(INCLUDE_OWED_KEY) === '1';
  }

  function setIncludeOwed(value) {
    localStorage.setItem(INCLUDE_OWED_KEY, value ? '1' : '0');
  }

  function readOrCreateUser() {
    const savedId = Number(localStorage.getItem(ACTIVE_USER_KEY));
    if (savedId) {
      const found = db.getUserById(savedId);
      if (found) {
        return found;
      }
    }

    let demoUser = db.getUserByIdentity('demo');
    if (!demoUser) {
      demoUser = db.createUser({
        username: 'demo',
        full_name: 'Demo User',
        mobile: null,
        email: 'demo@budgetwise.local',
        password_hash: 'local-only',
        allowance_day: 20
      });
    }

    localStorage.setItem(ACTIVE_USER_KEY, String(demoUser.id));
    return demoUser;
  }

  function getExcludedSet() {
    try {
      const value = localStorage.getItem(EXCLUDED_TX_KEY);
      const parsed = value ? JSON.parse(value) : [];
      return new Set(parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
    } catch (_error) {
      return new Set();
    }
  }

  function saveExcludedSet(setRef) {
    localStorage.setItem(EXCLUDED_TX_KEY, JSON.stringify(Array.from(setRef)));
  }

  function getPeopleByType(type) {
    const key = type === 'iowe' ? PEOPLE_IOWE_KEY : PEOPLE_OWE_KEY;
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
    const key = type === 'iowe' ? PEOPLE_IOWE_KEY : PEOPLE_OWE_KEY;
    localStorage.setItem(key, JSON.stringify(rows));
  }

  function nextPeopleId(type) {
    const rows = getPeopleByType(type);
    const max = rows.reduce((acc, item) => Math.max(acc, Number(item.id || 0)), 0);
    return max + 1;
  }

  function seedDemoData(userId) {
    const accountCount = db.queryValue('SELECT COUNT(*) AS total FROM accounts WHERE user_id = ?;', [userId]);
    if (Number(accountCount.total) === 0) {
      db.createAccount({ user_id: userId, name: 'BPI Savings', type: 'bank', balance: 12200 });
      db.createAccount({ user_id: userId, name: 'Maya Wallet', type: 'ewallet', balance: 34000 });
      db.createAccount({ user_id: userId, name: 'GCash', type: 'ewallet', balance: 7800 });
      db.createAccount({ user_id: userId, name: 'Security Bank', type: 'bank', balance: 24500 });
      db.createAccount({ user_id: userId, name: 'UnionBank', type: 'bank', balance: 31700 });
    }

    const transactionCount = db.queryValue('SELECT COUNT(*) AS total FROM transactions WHERE user_id = ?;', [userId]);
    if (Number(transactionCount.total) === 0) {
      const accounts = db.listAccounts(userId);
      const categories = db.listCategories('all');

      const accountByName = Object.fromEntries(accounts.map((item) => [item.name, item]));
      const categoryByName = Object.fromEntries(categories.map((item) => [item.name, item]));

      const seedTransactions = [
        { title: 'water bill', merchant: 'Fawn Source', amount: 82, type: 'expense', date: '2026-03-15', category: 'Bills and Utilities', account: 'BPI Savings', formula: '-60 (water) -22 (service fee)' },
        { title: 'ube boba', merchant: 'Kung Fu Tea', amount: 8.15, type: 'expense', date: '2026-03-12', category: 'Food and Dining', account: 'BPI Savings' },
        { title: 'final fantasy rebirth + dlc', merchant: 'Steam', amount: 84.98, type: 'expense', date: '2026-03-11', category: 'Entertainment', account: 'BPI Savings', formula: '-69.99 (base game) -14.99 (dlc)' },
        { title: 'korean sheet mask bundle', merchant: 'Olive Young', amount: 31.25, type: 'expense', date: '2026-03-11', category: 'Health and Medical', account: 'Maya Wallet' },
        { title: 'transfer to hysa', merchant: 'Wealthfront', amount: 1200, type: 'expense', date: '2026-03-10', category: 'Savings', account: 'BPI Savings' },
        { title: 'paycheck', merchant: 'Payroll', amount: 2300, type: 'income', date: '2026-03-08', category: 'Salary', account: 'BPI Savings' }
      ];

      seedTransactions.forEach((item) => {
        const account = accountByName[item.account];
        const category = categoryByName[item.category];
        if (!account) {
          return;
        }

        db.createTransaction({
          user_id: userId,
          account_id: account.id,
          category_id: category ? category.id : null,
          title: item.title,
          amount: item.amount,
          amount_formula: item.formula || null,
          merchant: item.merchant,
          type: item.type,
          date: item.date
        });
      });
    }

    if (!localStorage.getItem(PEOPLE_OWE_KEY)) {
      localStorage.setItem(
        PEOPLE_OWE_KEY,
        JSON.stringify([
          { id: 1, name: 'Alex', amount: 1400 },
          { id: 2, name: 'Mia', amount: 585 },
          { id: 3, name: 'Jon', amount: 2300 }
        ])
      );
    }

    if (!localStorage.getItem(PEOPLE_IOWE_KEY)) {
      localStorage.setItem(
        PEOPLE_IOWE_KEY,
        JSON.stringify([
          { id: 1, name: 'Liam', amount: 700 },
          { id: 2, name: 'Noah', amount: 450 }
        ])
      );
    }

    if (localStorage.getItem(INCLUDE_OWED_KEY) === null) {
      setIncludeOwed(false);
    }
  }

  function normalizeLower(value) {
    return String(value || '').toLowerCase();
  }

  function currentMonthKey() {
    return new Date().toISOString().slice(0, 7);
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
    const removeBtn = document.getElementById('accountRemove');

    if (!modal || !title || !nameInput || !balanceInput || !adjustInput || !removeBtn) {
      return;
    }

    currentAccountMode = mode;
    currentAccount = null;

    if (mode === 'create') {
      title.textContent = 'Add Account';
      nameInput.value = '';
      balanceInput.value = '';
      adjustInput.value = '';
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
  }

  function adjustAccountBalance(direction) {
    const balanceInput = document.getElementById('accountBalanceInput');
    const adjustInput = document.getElementById('accountAdjustInput');
    if (!balanceInput || !adjustInput) {
      return;
    }

    const current = Number(balanceInput.value || 0);
    const adjust = Math.abs(Number(adjustInput.value || 0));
    if (!Number.isFinite(adjust) || adjust <= 0) {
      return;
    }

    const next = direction === 'add' ? current + adjust : current - adjust;
    balanceInput.value = String(next);
    adjustInput.value = '';
  }

  function saveAccount() {
    const nameInput = document.getElementById('accountNameInput');
    const balanceInput = document.getElementById('accountBalanceInput');
    if (!nameInput || !balanceInput) {
      return;
    }

    const name = nameInput.value.trim();
    const balance = Number(balanceInput.value || 0);
    if (!name || !Number.isFinite(balance)) {
      return;
    }

    if (currentAccountMode === 'create') {
      db.createAccount({
        user_id: activeUser.id,
        name,
        type: 'bank',
        balance
      });
    } else if (currentAccount) {
      db.updateAccount(currentAccount.id, {
        name,
        balance,
        type: currentAccount.type
      });
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

  function openPeopleModal(mode, listType, itemId) {
    const modal = document.getElementById('peopleModal');
    const title = document.getElementById('peopleModalTitle');
    const nameInput = document.getElementById('peopleNameInput');
    const amountInput = document.getElementById('peopleAmountInput');
    const adjustInput = document.getElementById('peopleAdjustInput');
    const removeBtn = document.getElementById('peopleRemove');

    if (!modal || !title || !nameInput || !amountInput || !adjustInput || !removeBtn) {
      return;
    }

    currentPeopleListType = listType;
    currentPeopleMode = mode;
    currentPeopleItem = null;

    const titlePrefix = listType === 'iowe' ? 'Money I Owe To' : 'Money People Owe';

    if (mode === 'create') {
      title.textContent = `Add: ${titlePrefix}`;
      nameInput.value = '';
      amountInput.value = '';
      adjustInput.value = '';
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
  }

  function adjustPeopleAmount(direction) {
    const amountInput = document.getElementById('peopleAmountInput');
    const adjustInput = document.getElementById('peopleAdjustInput');
    if (!amountInput || !adjustInput) {
      return;
    }

    const current = Number(amountInput.value || 0);
    const adjust = Math.abs(Number(adjustInput.value || 0));
    if (!Number.isFinite(adjust) || adjust <= 0) {
      return;
    }

    const next = direction === 'add' ? current + adjust : current - adjust;
    amountInput.value = String(next);
    adjustInput.value = '';
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
    const accountsTotalValue = document.getElementById('accountsTotalValue');
    const peopleOweTotalValue = document.getElementById('peopleOweTotalValue');
    const peopleIOweTotalValue = document.getElementById('peopleIOweTotalValue');

    const owedOffBtn = document.getElementById('toggleOwedOff');
    const owedOnBtn = document.getElementById('toggleOwedOn');

    if (!txContainer || !accountsContainer || !oweContainer || !iOweContainer || !worthValue || !worthSubtext) {
      return;
    }

    const excludedSet = getExcludedSet();
    const transactions = db.listTransactions(activeUser.id).slice(0, 12).filter((txn) => !excludedSet.has(Number(txn.id)));
    const accounts = db.listAccounts(activeUser.id);

    const peopleOweRows = getPeopleByType('owe');
    const peopleIOweRows = getPeopleByType('iowe');

    const accountsTotal = accounts.reduce((sum, item) => sum + Number(item.balance || 0), 0);
    const peopleOweTotal = peopleOweRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const peopleIOweTotal = peopleIOweRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const include = includeOwed();
    const netWorth = include
      ? (accountsTotal + peopleOweTotal - peopleIOweTotal)
      : accountsTotal;

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
    if (include) {
      worthSubtext.textContent = `Accounts ${money(accountsTotal)} + Owed to you ${money(peopleOweTotal)} - You owe ${money(peopleIOweTotal)}`;
    } else {
      worthSubtext.textContent = `Accounts only: ${money(accountsTotal)} (Owed lists are off)`;
    }

    if (owedOffBtn && owedOnBtn) {
      owedOffBtn.classList.toggle('active', !include);
      owedOnBtn.classList.toggle('active', include);
    }

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
            <p class="account-value">${escapeHtml(money(account.balance))}</p>
          </div>
        `;
      }).join('');
    }

    if (peopleOweRows.length === 0) {
      oweContainer.innerHTML = '<p class="empty-copy">No entries yet.</p>';
    } else {
      oweContainer.innerHTML = peopleOweRows.map((row) => {
        return `
          <div class="owe-row" data-list-type="owe" data-people-id="${row.id}" title="Click to manage entry">
            <p class="owe-name"><span class="account-icon">${escapeHtml(initials(row.name))}</span>${escapeHtml(row.name)}</p>
            <p class="owe-value">${escapeHtml(money(row.amount))}</p>
          </div>
        `;
      }).join('');
    }

    if (peopleIOweRows.length === 0) {
      iOweContainer.innerHTML = '<p class="empty-copy">No entries yet.</p>';
    } else {
      iOweContainer.innerHTML = peopleIOweRows.map((row) => {
        return `
          <div class="owe-row" data-list-type="iowe" data-people-id="${row.id}" title="Click to manage entry">
            <p class="owe-name"><span class="account-icon">${escapeHtml(initials(row.name))}</span>${escapeHtml(row.name)}</p>
            <p class="owe-value">${escapeHtml(money(row.amount))}</p>
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
      const amountClass = txn.type === 'income' ? 'positive' : 'negative';
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
        const amountClass = txn.type === 'income' ? 'positive' : 'negative';
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

    const nowMonth = new Date().toISOString().slice(0, 7);
    const txs = db.listTransactions(activeUser.id, { month: nowMonth });

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
    txs.filter((item) => item.type === 'expense').forEach((item) => {
      const key = item.category_name || 'Uncategorized';
      grouped[key] = (grouped[key] || 0) + Number(item.amount || 0);
    });

    const top = Object.entries(grouped).sort((a, b) => b[1] - a[1])[0];
    topCategoryEl.textContent = top ? `${top[0]} (${money(top[1])})` : 'No expense data yet';
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

  async function start() {
    if (typeof window.createBudgetDB !== 'function') {
      return;
    }

    db = await window.createBudgetDB({ schemaPath: schemaPathForPage() });
    activeUser = readOrCreateUser();
    seedDemoData(activeUser.id);

    const page = currentPage();
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
      renderMonthlyOverview();
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
