// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FitGlass, LIMIT_LINE, MiniGlass } from '@/components/tool/FitGlass';
import { TargetBar } from '@/components/tool/TargetBar';
import { ToolProvider } from '@/components/tool/ToolProvider';
import { Unsupported } from '@/components/tool/Unsupported';

afterEach(cleanup);

describe('FitGlass', () => {
  it('puts the limit line at 78% and never fills past it', () => {
    expect(LIMIT_LINE).toBe(0.78);
    const { container } = render(<FitGlass bytes={9_999_999} target={10_000_000} />);
    const glass = container.querySelector('.glass') as HTMLElement;
    expect(glass.getAttribute('aria-hidden')).toBe('true');
    const level = Number(glass.style.getPropertyValue('--level'));
    expect(level).toBeLessThan(LIMIT_LINE);
    expect(level).toBeGreaterThan(0.77);
    expect((container.querySelector('.limit') as HTMLElement).style.top).toBe('22%');
  });
  it('mini glass shows no liquid for refused clips', () => {
    const { container } = render(<MiniGlass target={1} state="warn" />);
    expect(container.querySelector('.liq')).toBeNull();
    expect(container.querySelector('.mini.warn')).not.toBeNull();
  });
});

describe('TargetBar', () => {
  const setup = () =>
    render(
      <ToolProvider>
        <TargetBar optionsOpen={false} onToggleOptions={() => {}} />
      </ToolProvider>,
    );
  it('is a radiogroup with Discord (20 MB) preselected', () => {
    setup();
    const group = screen.getByRole('radiogroup', { name: 'Destination' });
    expect(group).toBeTruthy();
    const discord = screen.getByRole('radio', { name: /Discord Free, 20 MB/ });
    expect(discord.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('must-fit').textContent).toBe('Fits under 20 MB');
  });
  it('roving tabindex: one tab stop, arrows move focus', () => {
    setup();
    const radios = screen.getAllByRole('radio');
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(radios[1]);
  });
  it('selecting a size chip updates the limit', () => {
    setup();
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /^8 MB/ }));
    });
    expect(screen.getByTestId('must-fit').textContent).toBe('Fits under 8 MB');
  });
  it('custom size validates 1–4096 MB', () => {
    setup();
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /Custom/ }));
    });
    const input = screen.getByRole('textbox', { name: 'Custom size' });
    fireEvent.change(input, { target: { value: '0.5' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '12.5' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    });
    expect(screen.getByTestId('must-fit').textContent).toBe('Fits under 12.5 MB');
  });
});

describe('Unsupported', () => {
  it('lists what works', () => {
    render(
      <ToolProvider>
        <Unsupported />
      </ToolProvider>,
    );
    expect(screen.getByRole('heading', { name: "This browser can't compress video yet" })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // jsdom has no Worker/WebCodecs: the "no video engine" explanation, not the engine-failed one.
    expect(screen.getByText(/this one doesn't have it/)).toBeTruthy();
  });
});
