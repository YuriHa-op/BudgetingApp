(function () {
  'use strict';

  const ACTIVE_USER_KEY = 'budgetwise_active_user_id';

  function hashPassword(raw) {
    const text = `budgetwise::${String(raw || '')}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `bw_${(hash >>> 0).toString(16)}`;
  }

  function setFeedback(message, tone) {
    const feedback = document.getElementById('authFeedback');
    if (!feedback) {
      return;
    }
    feedback.textContent = message;
    feedback.classList.remove('error', 'success');
    if (tone) {
      feedback.classList.add(tone);
    }
  }

  function setTab(name) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabGroup = document.getElementById('authTabGroup');
    if (!loginForm || !registerForm || !tabGroup) {
      return;
    }

    const loginActive = name === 'login';
    loginForm.classList.toggle('hidden', !loginActive);
    registerForm.classList.toggle('hidden', loginActive);

    Array.from(tabGroup.querySelectorAll('[data-tab]')).forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
    });

    setFeedback('');
  }

  function bindTabs() {
    const tabGroup = document.getElementById('authTabGroup');
    if (!tabGroup) {
      return;
    }

    tabGroup.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-tab]');
      if (!btn) {
        return;
      }
      setTab(btn.getAttribute('data-tab'));
    });
  }

  function bindRegister(db) {
    const form = document.getElementById('registerForm');
    if (!form) {
      return;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      const fullName = String(document.getElementById('registerFullName')?.value || '').trim();
      const username = String(document.getElementById('registerUsername')?.value || '').trim();
      const email = String(document.getElementById('registerEmail')?.value || '').trim().toLowerCase();
      const password = String(document.getElementById('registerPassword')?.value || '');

      if (!fullName || !username || !email || password.length < 6) {
        setFeedback('Please complete all fields. Password must be at least 6 characters.', 'error');
        return;
      }

      const existingByUsername = db.queryValue('SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1;', [username]);
      if (existingByUsername) {
        setFeedback('That username is already taken.', 'error');
        return;
      }

      const existingByEmail = db.queryValue('SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1;', [email]);
      if (existingByEmail) {
        setFeedback('That email is already registered.', 'error');
        return;
      }

      try {
        const created = db.createUser({
          username,
          full_name: fullName,
          mobile: null,
          email,
          password_hash: hashPassword(password),
          allowance_day: 1
        });

        localStorage.setItem(ACTIVE_USER_KEY, String(created.id));
        setFeedback('Registration successful. Redirecting...', 'success');
        window.setTimeout(function () {
          window.location.href = 'home.html';
        }, 250);
      } catch (error) {
        setFeedback('Unable to create account. Please try again.', 'error');
        console.error('[BudgetWise] register failed', error);
      }
    });
  }

  function bindLogin(db) {
    const form = document.getElementById('loginForm');
    if (!form) {
      return;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      const identity = String(document.getElementById('loginIdentity')?.value || '').trim();
      const password = String(document.getElementById('loginPassword')?.value || '');
      if (!identity || !password) {
        setFeedback('Enter your username/email and password.', 'error');
        return;
      }

      const user = db.queryValue(
        'SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1;',
        [identity, identity]
      );

      if (!user || user.password_hash !== hashPassword(password)) {
        setFeedback('Invalid credentials. Please try again.', 'error');
        return;
      }

      localStorage.setItem(ACTIVE_USER_KEY, String(user.id));
      setFeedback('Login successful. Redirecting...', 'success');
      window.setTimeout(function () {
        window.location.href = 'home.html';
      }, 200);
    });
  }

  async function start() {
    if (typeof window.createBudgetDB !== 'function') {
      return;
    }

    const db = await window.createBudgetDB({ schemaPath: 'schema.sql' });

    const currentUserId = Number(localStorage.getItem(ACTIVE_USER_KEY));
    if (currentUserId) {
      const currentUser = db.getUserById(currentUserId);
      if (currentUser) {
        window.location.href = 'home.html';
        return;
      }
      localStorage.removeItem(ACTIVE_USER_KEY);
    }

    bindTabs();
    bindRegister(db);
    bindLogin(db);
  }

  window.addEventListener('DOMContentLoaded', function () {
    start().catch(function (error) {
      setFeedback('Auth page failed to initialize.', 'error');
      console.error('[BudgetWise] auth bootstrap failed', error);
    });
  });
})();
