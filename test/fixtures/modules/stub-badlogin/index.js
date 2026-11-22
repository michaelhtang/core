// onLogin always throws: login must still work, and the modules after this one must still run.
import { defineModule } from '../../../../lib/modules.js';

export default defineModule({
  id: 'stub-badlogin',
  onLogin() { throw new Error('onLogin exploded'); },
});
