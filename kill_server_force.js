
import { execSync } from 'child_process';
try {
    console.log('Checking port 3000...');
    // Force kill anything on port 3000
    const stdout = execSync('lsof -i :3000 -t').toString().trim();
    if (stdout) {
        const pids = stdout.split('\n');
        for (const pid of pids) {
            if (pid) {
                console.log('Killing PID:', pid);
                execSync(`kill -9 ${pid}`);
            }
        }
    }
} catch (e) {
    console.log('Error or no process found:', e.message);
}
