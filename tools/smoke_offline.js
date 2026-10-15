// Real Gradle integration test: download a dependency over HTTP, stop the repository,
// then clean and rebuild offline. Usage: node tools/smoke_offline.js /path/to/gradle
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { configureWrapper, cacheSettings } = require('../out/project');
const { saveOffline, runGradle } = require('../out/offline');

async function main() {
    if (process.platform === 'win32') { throw new Error('This integration harness requires POSIX sh. Windows wrapper conversion is covered by unit tests.'); }
    const gradle = process.argv[2];
    if (!gradle || !fs.existsSync(gradle)) { throw new Error('Pass an installed Gradle executable path. JDK 25+ must be on PATH.'); }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'w4studica-offline-smoke-'));
    const root = path.join(temporary, 'project with spaces');
    const source = path.join(temporary, 'Library.java');
    fs.writeFileSync(source, 'package offline.fixture; public class Library { public static int value() { return 7; } }');
    const classes = path.join(temporary, 'classes');
    fs.mkdirSync(classes);
    execFileSync('javac', ['-d', classes, source]);
    const library = path.join(temporary, 'library-1.0.jar');
    execFileSync('jar', ['cf', library, '-C', classes, '.']);
    let downloads = 0;
    const server = http.createServer((request, response) => {
        if (request.url === '/offline/fixture/library/1.0/library-1.0.pom') {
            response.end('<project><modelVersion>4.0.0</modelVersion><groupId>offline.fixture</groupId><artifactId>library</artifactId><version>1.0</version></project>');
        } else if (request.url === '/offline/fixture/library/1.0/library-1.0.jar') {
            downloads++;
            response.end(fs.readFileSync(library));
        } else { response.statusCode = 404; response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        fs.mkdirSync(path.join(root, 'src/main/java'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src/main/java/Main.java'), 'public class Main { public static int value = offline.fixture.Library.value(); }');
        fs.writeFileSync(path.join(root, 'settings.gradle'), 'rootProject.name="offline-smoke"');
        fs.writeFileSync(path.join(root, 'build.gradle'), `plugins { id 'java' }
repositories { maven { url = 'http://127.0.0.1:${server.address().port}'; allowInsecureProtocol = true } }
dependencies { implementation 'offline.fixture:library:1.0' }
tasks.register('assertOffline') { doLast { assert gradle.startParameter.offline } }
`);
        fs.writeFileSync(path.join(root, 'gradlew'), configureWrapper(`#!/bin/sh
APP_HOME='${root}'
JAVACMD='${path.resolve(gradle)}'
exec "$JAVACMD" "$@"
`, false), { mode: 0o755 });
        const init = path.join(root, '.w4studica/gradle-home/init.d');
        fs.mkdirSync(init, { recursive: true });
        fs.writeFileSync(path.join(init, 'w4studica.gradle'), cacheSettings);
        const state = { schemaVersion: 1, target: 'systemcore', installation: {
            gradlerio: { manifest: { sha256: 'fixture' } }, allwpilib: { manifest: { sha256: 'fixture' } }
        } };
        const log = text => process.stdout.write(text + '\n');
        await saveOffline(root, state, log);
        if (!downloads) { throw new Error('Fixture dependency was never downloaded.'); }
        await new Promise(resolve => server.close(resolve));
        await runGradle(root, ['--no-daemon', 'clean', 'build', 'assertOffline'], false, log);
        console.log('PASS: repository stopped; clean build used the saved dependency and automatic offline mode.');
    } finally {
        server.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
