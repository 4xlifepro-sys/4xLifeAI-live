const { createClient } = require('@supabase/supabase-js');
try {
  createClient('invalid-path', 'xyz');
} catch (e) {
  console.log(e.message);
}
