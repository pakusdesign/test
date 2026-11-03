// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VacancyProgressRing, type VacancyProgressRingProps } from '../../src/client/components/ring/VacancyProgressRing';
import { GROUP_ARC_LENGTH } from '../../src/client/components/ring/geometry';
import type { AudioMeter } from '../../src/client/audio/level';

const none = [false, false, false, false, false, false, false, false];
const props = (patch: Partial<VacancyProgressRingProps> = {}): VacancyProgressRingProps => ({
  validConfirmedUnits: none,
  stage: 'review',
  activeQuestionId: 'q1',
  answeredCount: 0,
  connectionState: 'online',
  reducedMotion: false,
  ...patch,
});

afterEach(cleanup);

function groups(container: HTMLElement) {
  return [...container.querySelectorAll('.vpr__group')].map((g) => g.getAttribute('data-filled'));
}

function offsets(container: HTMLElement) {
  return [...container.querySelectorAll<SVGPathElement>('.vpr__mask-arc')].map((p) => Number(p.style.strokeDashoffset));
}

describe('VacancyProgressRing', () => {
  it('64 нейтральных и 64 акцентных штриха; доступность progressbar', () => {
    const { container, getByRole } = render(<VacancyProgressRing {...props()} />);
    expect(container.querySelectorAll('.vpr__tick')).toHaveLength(64);
    expect(container.querySelectorAll('.vpr__fill')).toHaveLength(64);
    const bar = getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-label')).toBe('Полнота требований к вакансии');
    // Круг не в Tab-порядке.
    expect(bar.getAttribute('tabindex')).toBeNull();
  });

  it('T34: разреженное заполнение — светятся только группы q2 и q4', () => {
    const v = [false, false, true, true, false, false, true, true];
    const { container, getByRole } = render(<VacancyProgressRing {...props({ validConfirmedUnits: v })} />);
    expect(groups(container)).toEqual(v.map(String));
    expect(offsets(container).map((o) => o === 0)).toEqual(v);
    expect(getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Подтверждено 4 из 8 частей; полнота 50 процента');
  });

  it('12.5% → подпись 13%, точное значение в aria-valuenow', () => {
    const { container, getByRole } = render(<VacancyProgressRing {...props({ validConfirmedUnits: [true, ...none.slice(1)] })} />);
    expect(container.querySelector('.vpr__value')!.textContent).toBe('13%');
    expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('12.5');
  });

  it('направление перехода: рост — up (400 ms), снижение — down (240 ms); остальные группы не трогаются', () => {
    const { container, rerender } = render(<VacancyProgressRing {...props()} />);
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: [true, true, ...none.slice(2)] })} />);
    const dirs = () => [...container.querySelectorAll('.vpr__mask-arc')].map((p) => p.getAttribute('data-dir'));
    expect(dirs().slice(0, 3)).toEqual(['up', 'up', 'none']);
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: [true, false, ...none.slice(2)] })} />);
    expect(dirs().slice(0, 2)).toEqual(['up', 'down']);
    expect(offsets(container)[1]).toBeCloseTo(GROUP_ARC_LENGTH);
  });

  it('первичный показ: знак 100% без анимации; первое достижение — с задержкой; снижение убирает знак', () => {
    const all = Array(8).fill(true);
    const first = render(<VacancyProgressRing {...props({ validConfirmedUnits: all })} />);
    const icon = () => first.container.querySelector('.vpr__success')!;
    expect(icon().getAttribute('data-visible')).toBe('true');
    expect(icon().getAttribute('data-animate')).toBe('false');
    first.unmount();

    const { container, rerender } = render(<VacancyProgressRing {...props({ validConfirmedUnits: [...all.slice(1), false] })} />);
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: all })} />);
    const success = () => container.querySelector('.vpr__success')!;
    expect(success().getAttribute('data-animate')).toBe('true');
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: all, activeQuestionId: 'q2' })} />);
    expect(success().getAttribute('data-animate')).toBe('false');
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: [...all.slice(1), false] })} />);
    expect(success().getAttribute('data-visible')).toBe('false');
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: all })} />);
    expect(success().getAttribute('data-animate')).toBe('false');
  });

  it('T35: запись, уровень голоса и ожидание не меняют процент', () => {
    const v = [true, true, ...none.slice(2)];
    const { container, rerender } = render(<VacancyProgressRing {...props({ validConfirmedUnits: v })} />);
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: v, stage: 'recording', audioLevel: 1 })} />);
    expect(container.querySelector('.vpr__value')!.textContent).toBe('25%');
    expect(container.querySelector('.vpr__halo-wrap')!.getAttribute('data-active')).toBe('true');
    rerender(<VacancyProgressRing {...props({ validConfirmedUnits: v, stage: 'processing', processing: { key: 'r1', label: 'Проверяем, хватает ли сведений' } })} />);
    expect(container.querySelector('.vpr__value')!.textContent).toBe('25%');
    expect(container.querySelector('.vpr__halo-wrap')!.getAttribute('data-active')).toBe('false');
    expect(offsets(container).slice(0, 2)).toEqual([0, 0]);
  });

  it('InlineLoading появляется только после 150 мс; до этого — текст этапа', () => {
    vi.useFakeTimers();
    const { container } = render(<VacancyProgressRing {...props({ stage: 'processing', processing: { key: 'r2', label: 'Составляем описание вакансии' } })} />);
    expect(container.querySelector('.cds--inline-loading')).toBeNull();
    expect(container.querySelector('.vpr__stage')!.textContent).toContain('Составляем описание вакансии');
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(container.querySelectorAll('.cds--inline-loading')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('reduced motion: статичная отметка ожидания вместо InlineLoading', () => {
    const { container } = render(<VacancyProgressRing {...props({ reducedMotion: true, stage: 'processing', processing: { key: 'r3', label: 'Проверяем' } })} />);
    expect(container.querySelector('.vpr')!.getAttribute('data-reduced-motion')).toBe('true');
    expect(container.querySelector('.vpr__static-wait')).not.toBeNull();
    expect(container.querySelector('.cds--inline-loading')).toBeNull();
  });

  it('ореол подписывается на реальный сигнал и отписывается после записи', () => {
    const listeners = new Set<(l: number) => void>();
    const meter: AudioMeter = {
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      stop: () => undefined,
    };
    const { container, rerender } = render(<VacancyProgressRing {...props({ stage: 'recording', audioMeter: meter })} />);
    expect(listeners.size).toBe(1);
    act(() => [...listeners].forEach((l) => l(1)));
    const halo = container.querySelector<SVGCircleElement>('.vpr__halo')!;
    expect(halo.style.transform).toBe('scale(1.03)');
    rerender(<VacancyProgressRing {...props({ stage: 'processing', audioMeter: meter })} />);
    expect(listeners.size).toBe(0);
    expect(halo.style.transform).toBe('');
  });
});
