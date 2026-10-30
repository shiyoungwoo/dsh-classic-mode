// Browser half of the classic-mode button: one entry at the sidebar foot that
// asks the host half to open the classic (DS-Bot-free) Harness UI in Safari.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so this file needs no build
// step and imports nothing from the host. It calls the plugin's own route,
// which owns the server start, the token, and the browser call.
//
// Geometry and ink copy ds-bot's own sidebar-foot entry (.bt-return: 36px pill,
// 999px radius, 0 14px padding, 8px gap, 20px mark, --bt-ink-deepseek #4D6BFE)
// so the two entries sit side by side without optical mismatch.
window.__ModuleLoader__.load({
  id: '@local/dsh-classic-mode',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var IDLE = 'idle';
    var BUSY = 'busy';
    var DONE = 'done';
    var FAILED = 'failed';

    var LABELS = {
      idle: '经典模式',
      busy: '启动中…',
      done: '已打开',
      failed: '打开失败',
    };

    var TITLES = {
      idle: '在 Safari 中打开经典模式（无 DS Bot 的 dsh 界面）',
      busy: '正在启动经典模式，首次启动约需 10 秒',
      done: '已在 Safari 中打开',
      failed: '打开失败，悬停查看原因',
    };

    // Label states return to idle on their own: a settled button that keeps
    // reporting the last result would read as a stuck state.
    var SETTLE_MS = 2600;

    // The official DeepSeek whale, the same primitive the shell's brand mark
    // and DS Bot's own entries draw.
    var MARK_INK = '#4D6BFE';
    var MARK_SIZE = 20;

    /**
     * One sidebar-foot button that opens the classic UI.
     *
     * @param {object} props - Slot props; the sidebar hands each action `wide`.
     * @returns {object} The button element.
     */
    function ClassicModeButton(props) {
      var react = require('react');
      var ui = require('@deepseek-ai/dsh-client-ui-primitives');
      var wide = !!(props && props.wide);

      var state = react.useState(IDLE);
      var phase = state[0];
      var setPhase = state[1];
      var detail = react.useState('');
      var detailText = detail[0];
      var setDetail = detail[1];
      var hover = react.useState(false);
      var hovering = hover[0];
      var setHovering = hover[1];

      react.useEffect(function () {
        if (phase !== DONE && phase !== FAILED) return undefined;
        var timer = setTimeout(function () {
          setPhase(IDLE);
        }, SETTLE_MS);
        return function () {
          clearTimeout(timer);
        };
      }, [phase]);

      var onClick = react.useCallback(
        function () {
          if (phase === BUSY) return;
          setPhase(BUSY);
          setDetail('');
          fetch('/classic-mode/open')
            .then(function (response) {
              return response.json().then(function (body) {
                return { ok: response.ok && body.ok !== false, body: body };
              });
            })
            .then(function (result) {
              if (result.ok) {
                setPhase(DONE);
                setDetail(result.body.started ? '已启动经典模式并打开' : '复用已在运行的经典模式');
                return;
              }
              setPhase(FAILED);
              setDetail(String(result.body.error || '未知错误'));
            })
            .catch(function (error) {
              setPhase(FAILED);
              setDetail(String(error && error.message ? error.message : error));
            });
        },
        [phase],
      );

      var style = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 36,
        padding: '0 14px',
        border: 0,
        borderRadius: 999,
        background: hovering && phase !== BUSY ? 'rgba(127,127,127,0.14)' : 'none',
        color: 'inherit',
        font: 'inherit',
        fontSize: 14,
        lineHeight: '20px',
        cursor: phase === BUSY ? 'progress' : 'pointer',
        opacity: phase === BUSY ? 0.7 : 1,
        whiteSpace: 'nowrap',
        transition: 'background-color .12s ease',
      };

      return react.createElement(
        'button',
        {
          type: 'button',
          className: 'classic-mode-return',
          'aria-label': '经典模式',
          style: style,
          title: detailText ? detailText : TITLES[phase],
          onClick: onClick,
          onMouseEnter: function () {
            setHovering(true);
          },
          onMouseLeave: function () {
            setHovering(false);
          },
        },
        react.createElement(
          'span',
          {
            'aria-hidden': true,
            style: { display: 'inline-flex', flex: 'none', lineHeight: 0, color: MARK_INK },
          },
          react.createElement(ui.FishLogo, { size: MARK_SIZE }),
        ),
        wide
          ? react.createElement(
              'span',
              { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              LABELS[phase],
            )
          : null,
      );
    }

    /**
     * Mount the sidebar-foot entry.
     *
     * @param {object} ctx - Client plugin context.
     * @returns {void}
     */
    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'classic-mode', order: -300 },
          ClassicModeButton,
        );
      });
    }

    exports.apply = apply;
    // Without this the entry gets no `ctx.slots`, fails activation, and the
    // whole Web boot fails with `web boot: N entries did not activate`.
    exports.inject = ['slots'];
    return module.exports;
  },
});
