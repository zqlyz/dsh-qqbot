import { describe, it, expect } from 'vitest';
import {
  ConfigSchema,
  HISTORY_INTERVAL_TIMER_DEFAULT,
  resolveHistoryIntervalTimer,
} from './config.ts';

describe('ConfigSchema 默认值（内层外层默认必须对齐：#94-1 不变量）', () => {
  it('完全省略 access → c2cMode open（子 schema 默认生效）', () => {
    const cfg = ConfigSchema({});
    expect(cfg.access.c2cMode).toBe('open');
    expect(cfg.access.groupMode).toBe('open');
  });

  it('access: {} → 子字段默认填充 open', () => {
    const cfg = ConfigSchema({ access: {} });
    expect(cfg.access.c2cMode).toBe('open');
  });

  it('access 空值（YAML access: 后无内容）→ open', () => {
    const cfg = ConfigSchema({ access: null });
    expect(cfg.access.c2cMode).toBe('open');
  });

  it('显式配置不受默认影响', () => {
    const cfg = ConfigSchema({ access: { c2cMode: 'allowlist' } });
    expect(cfg.access.c2cMode).toBe('allowlist');
  });
});


describe('historyIntervalTimer（30–3600 秒，非法值回退默认 180）', () => {
  it('省略时使用默认 180 秒', () => {
    expect(ConfigSchema({}).historyIntervalTimer).toBe(180);
    expect(HISTORY_INTERVAL_TIMER_DEFAULT).toBe(180);
  });

  it('接受闭区间 30–3600 的整数秒', () => {
    expect(ConfigSchema({ historyIntervalTimer: 30 }).historyIntervalTimer).toBe(30);
    expect(ConfigSchema({ historyIntervalTimer: 600 }).historyIntervalTimer).toBe(600);
    expect(ConfigSchema({ historyIntervalTimer: 3600 }).historyIntervalTimer).toBe(3600);
  });

  it('越界 / 小数 / 非数字回退默认值', () => {
    expect(ConfigSchema({ historyIntervalTimer: 29 }).historyIntervalTimer).toBe(180);
    expect(ConfigSchema({ historyIntervalTimer: 3601 }).historyIntervalTimer).toBe(180);
    expect(ConfigSchema({ historyIntervalTimer: 180.5 }).historyIntervalTimer).toBe(180);
    expect(ConfigSchema({ historyIntervalTimer: 'abc' as never }).historyIntervalTimer).toBe(180);
    expect(resolveHistoryIntervalTimer(undefined)).toBe(180);
    expect(resolveHistoryIntervalTimer(Number.NaN)).toBe(180);
  });
});
