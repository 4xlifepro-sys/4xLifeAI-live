const fs = require('fs');
let code = fs.readFileSync('server/scanner.ts', 'utf8');

code = code.replace(
`                 if (auditMatches && auditMatches.length > 0) {
                   await supabase
                     .from('signal_audit_log')
                     .update(updatePayload)
                     .eq('id', auditMatches[0].id);
                 }
                   
                 if (auditUpdateErr) {
                   console.error("Failed to update signal_audit_log:", auditUpdateErr.message);
                 }`,
`                 if (auditMatches && auditMatches.length > 0) {
                   const { error: auditUpdateErr } = await supabase
                     .from('signal_audit_log')
                     .update(updatePayload)
                     .eq('id', auditMatches[0].id);

                   if (auditUpdateErr) {
                     console.error("Failed to update signal_audit_log:", auditUpdateErr.message);
                   }
                 }`
);

fs.writeFileSync('server/scanner.ts', code);
