// Apply theme before paint to avoid a flash
      try {
        var t = localStorage.getItem('cs-theme') || 'system';
        var d = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (d) document.documentElement.classList.add('dark');
        var l = localStorage.getItem('cs-lang');
        if (l === 'en') { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; }
      } catch (e) {}
