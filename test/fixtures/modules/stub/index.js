// A module that records what the kernel hands to its hooks.
import { defineModule } from '../../../../lib/modules.js';

export const seen = [];
export default defineModule({
  id: 'stub',
  onLogin(k, player) { seen.push(player); },
});
