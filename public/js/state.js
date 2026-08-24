import { todayStr } from './util.js';

// Global client state shared across view modules.
export const App = {
  user: null,
  profile: null,
  date: todayStr(), // selected dashboard day
};

export function profileComplete(p) {
  return !!(p && p.age != null && p.height_cm != null && p.current_weight != null);
}
