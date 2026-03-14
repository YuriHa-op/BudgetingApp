(function () {
  'use strict';

  var TAB_LAST_KEY = 'budgetwise_last_tab';
  var nav = document.getElementById('tabNav');
  if (!nav) {
    return;
  }

  var links = Array.prototype.slice.call(nav.querySelectorAll('a'));
  var current = window.location.pathname.split('/').pop() || 'home.html';
  var activeLink = null;

  var indicator = document.createElement('span');
  indicator.className = 'tab-indicator';
  nav.insertBefore(indicator, nav.firstChild);

  function basename(href) {
    return (href || '').split('/').pop();
  }

  function placeIndicator(link, animated) {
    if (!link) {
      return;
    }

    if (!animated) {
      indicator.style.transition = 'none';
    } else {
      indicator.style.transition = '';
    }

    indicator.style.width = link.offsetWidth + 'px';
    indicator.style.transform = 'translateX(' + link.offsetLeft + 'px)';

    if (!animated) {
      requestAnimationFrame(function () {
        indicator.style.transition = '';
      });
    }
  }

  for (var i = 0; i < links.length; i += 1) {
    var href = links[i].getAttribute('href') || '';
    var target = basename(href);

    if (target === current) {
      links[i].classList.add('active');
      activeLink = links[i];
    }

    links[i].addEventListener('click', function (event) {
      var link = event.currentTarget;
      var targetFile = basename(link.getAttribute('href') || '');
      if (targetFile) {
        sessionStorage.setItem(TAB_LAST_KEY, targetFile);
      }
    });
  }

  if (!activeLink && links.length > 0) {
    activeLink = links[0];
    activeLink.classList.add('active');
  }

  var lastTab = sessionStorage.getItem(TAB_LAST_KEY);
  var fromLink = null;
  if (lastTab) {
    for (var j = 0; j < links.length; j += 1) {
      if (basename(links[j].getAttribute('href') || '') === lastTab) {
        fromLink = links[j];
        break;
      }
    }
  }

  if (fromLink && activeLink && fromLink !== activeLink) {
    placeIndicator(fromLink, false);
    requestAnimationFrame(function () {
      placeIndicator(activeLink, true);
    });
  } else {
    placeIndicator(activeLink, false);
  }

  window.addEventListener('resize', function () {
    placeIndicator(activeLink, false);
  });
})();
