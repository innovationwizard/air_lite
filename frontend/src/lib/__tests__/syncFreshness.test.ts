import { syncAgeLabel, syncIsStale } from '../syncFreshness';

const now = Date.parse('2026-10-16T08:00:00Z');

it('una corrida de hace una hora sigue fresca', () => {
  const finished = '2026-10-16T07:00:00Z';
  expect(syncIsStale(finished, now)).toBe(false);
  expect(syncAgeLabel(finished, now)).toBeNull();
});

it('a las tres horas la pastilla dice la edad', () => {
  const finished = '2026-10-16T04:00:00Z';
  expect(syncIsStale(finished, now)).toBe(true);
  expect(syncAgeLabel(finished, now)).toBe('hace 4 h');
});

it('sin hora de fin no inventa una edad', () => {
  expect(syncIsStale(null, now)).toBe(false);
  expect(syncAgeLabel(undefined, now)).toBeNull();
});
