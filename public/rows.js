// Bảng nhập có nút thêm dòng, xóa dòng. Vùng chứa có data-rows, mỗi dòng có class "dr", ô chính của dòng có data-key.
(function () {
  document.querySelectorAll('[data-rows]').forEach(function (box) {
    var rows = [].slice.call(box.querySelectorAll('.dr')), min = +box.dataset.min || 1;
    var add = box.querySelector('[data-add]');
    var used = function (r) { var k = r.querySelector('[data-key]'); return !!(k && k.value.trim()); };
    var fire = function () { var f = box.closest('form'); if (f) f.dispatchEvent(new Event('input', { bubbles: true })); };
    function number() {
      var vis = rows.filter(function (r) { return !r.hidden; });
      vis.forEach(function (r, i) { var n = r.querySelector('.dr-n'); if (n) n.textContent = i + 1;
        var d = r.querySelector('.dr-del'); if (d) d.style.visibility = vis.length > min ? '' : 'hidden'; });
      if (add) add.style.display = rows.some(function (r) { return r.hidden; }) ? '' : 'none';
    }
    function clear(r) {
      r.querySelectorAll('input').forEach(function (i) { if (i.type === 'checkbox') i.checked = false; else i.value = i.dataset.def || ''; delete i.dataset.touched; });
      r.querySelectorAll('select').forEach(function (s) { s.selectedIndex = 0; s.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    function sync() { var n = 0; rows.forEach(function (r) { r.hidden = !used(r); if (!r.hidden) n++; });
      for (var i = 0; n < min && i < rows.length; i++) if (rows[i].hidden) { rows[i].hidden = false; n++; }
      number(); }
    rows.forEach(function (r) {
      var d = r.querySelector('.dr-del');
      if (d) d.addEventListener('click', function () { clear(r); r.hidden = true; box.querySelector('.dr') && r.parentNode.appendChild(r); rows.push(rows.splice(rows.indexOf(r), 1)[0]); number(); fire(); });
    });
    if (add) add.addEventListener('click', function () { var r = rows.filter(function (x) { return x.hidden; })[0]; if (!r) return; r.hidden = false; number();
      var k = r.querySelector('[data-key]') || r.querySelector('input,select'); if (k) k.focus(); });
    box.drSync = sync; sync();
  });
})();
