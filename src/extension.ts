import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { candidateDownloadSize, findInstallation, Installation, installComponent, InstallProgress } from './releases';
import { configureProject, detectTarget, readState, refreshVmxScript, Target } from './project';
import { saveOffline } from './offline';
import { io } from './files';

function installationIsInWpilibHome(installation: Installation, w4Home: string): boolean {
    const releaseRoot = path.resolve(w4Home, 'releases') + path.sep;
    return [installation.gradlerio.directory, installation.allwpilib.directory].every(directory => path.resolve(directory).startsWith(releaseRoot));
}

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('W4Studica');
    context.subscriptions.push(output);
    const busy = new Set<string>();

    async function workspace(): Promise<vscode.WorkspaceFolder | undefined> {
        if (!vscode.workspace.isTrusted) { throw new Error('Trust this workspace before modifying or running its Gradle build.'); }
        const folders = vscode.workspace.workspaceFolders || [];
        if (!folders.length) { throw new Error('Open a WPILib 2027 project folder first.'); }
        if (folders.length === 1) { return folders[0]; }
        const selected = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), { placeHolder: 'Select the robot project' });
        return selected && selected.folder;
    }

    async function install(folder: vscode.WorkspaceFolder, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<Installation> {
        const settings = vscode.workspace.getConfiguration('w4studica', folder.uri);
        progress.report({ message: 'Checking compatible WPILib releases…' });
        const pair = await findInstallation({
            gradlerio: settings.get<string>('gradleRIORepository', 'W4Studica/GradleRIO'),
            allwpilib: settings.get<string>('allwpilibRepository', 'W4Studica/allwpilib')
        }, settings.get<boolean>('includePrereleases', true));
        const storage = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica');
        const log = (text: string) => output.appendLine(text);
        const downloads = [pair.gradlerio, pair.allwpilib];
        const sizes = downloads.map(candidateDownloadSize);
        const totalSize = sizes.reduce((sum, size) => sum + size, 0);
        const startedAt = Date.now();
        let completedBytes = 0;
        let reportedPercent = 0;
        const onProgress = (index: number) => (state: InstallProgress) => {
            const size = sizes[index];
            const current = state.cached ? size : size > 0 && state.total > 0 ? size * Math.min(1, state.transferred / state.total) : 0;
            const bytesDone = Math.min(totalSize, completedBytes + current);
            const percent = totalSize > 0 ? Math.min(90, Math.floor(bytesDone / totalSize * 90)) : 0;
            const seconds = (Date.now() - startedAt) / 1000;
            const speed = seconds > 1 ? bytesDone / seconds : 0;
            const remaining = speed > 0 ? Math.ceil((totalSize - bytesDone) / speed) : undefined;
            const eta = remaining === undefined ? 'estimating time…' : remaining < 60 ? `about ${remaining}s left` : `about ${Math.floor(remaining / 60)}m ${remaining % 60}s left`;
            const label = state.component === 'gradlerio' ? 'GradleRIO' : 'WPILib';
            const detail = state.cached ? `${label} already installed` : `${percent}% · ${eta} · ${label}${state.archive ? ' — ' + state.archive : ''}`;
            progress.report({ increment: Math.max(0, percent - reportedPercent), message: detail });
            reportedPercent = Math.max(reportedPercent, percent);
        };
        const gradlerio = await installComponent(pair.gradlerio, storage, log, undefined, onProgress(0));
        completedBytes += sizes[0];
        const allwpilib = await installComponent(pair.allwpilib, storage, log, undefined, onProgress(1));
        completedBytes += sizes[1];
        progress.report({ increment: Math.max(0, 100 - reportedPercent), message: 'Downloads verified and installed' });
        return { gradlerio, allwpilib };
    }

    function command(id: string, action: (folder: vscode.WorkspaceFolder, progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>): void {
        context.subscriptions.push(vscode.commands.registerCommand('vmxpi-wsr.' + id, async () => {
            let root: string | undefined;
            let acquired = false;
            try {
                const folder = await workspace();
                if (!folder) { return; }
                root = folder.uri.fsPath;
                if (busy.has(root)) { throw new Error('Another W4Studica operation is running for this project.'); }
                const dirty = vscode.workspace.textDocuments.filter(doc => doc.isDirty && doc.uri.fsPath.startsWith(root + path.sep));
                if (dirty.length) { throw new Error('Save the project files before running W4Studica commands.'); }
                busy.add(root);
                acquired = true;
                output.show(true);
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'W4Studica', cancellable: false }, progress => action(folder, progress));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                output.appendLine(message);
                vscode.window.showErrorMessage('W4Studica: ' + message);
            } finally { if (root && acquired) { busy.delete(root); } }
        }));
    }

    async function changeTarget(folder: vscode.WorkspaceFolder, target: Target, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        const root = folder.uri.fsPath;
        const w4Home = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica');
        const old = await readState(root, w4Home);
        const current = detectTarget(await io.readFile(path.join(root, 'build.gradle'), 'utf8'));
        if (current === target && old && old.target === target && old.schemaVersion === 2) { vscode.window.showInformationMessage('The deploy target is already ' + (target === 'vmx' ? 'VMX' : 'SystemCore') + '.'); return; }
        const installation = old && old.schemaVersion === 2 && installationIsInWpilibHome(old.installation, w4Home)
            ? old.installation : await install(folder, progress);
        await configureProject(root, installation, target, w4Home);
        vscode.window.showInformationMessage('Deploy target changed to ' + (target === 'vmx' ? 'VMX-Pi.' : 'SystemCore.') + ' Run Save W4Studica Offline again to prepare dependencies for this target.');
    }

    command('setVMXPiTarget', (folder, progress) => changeTarget(folder, 'vmx', progress));
    command('setSystemCoreTarget', (folder, progress) => changeTarget(folder, 'systemcore', progress));
    command('updateW4Studica', async (folder, progress) => {
        const root = folder.uri.fsPath;
        const w4Home = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica');
        const current = await readState(root, w4Home);
        const installation = await install(folder, progress);
        const target = detectTarget(await io.readFile(path.join(root, 'build.gradle'), 'utf8'));
        if (current && current.target === target && JSON.stringify(current.installation) === JSON.stringify(installation)) {
            if (target === 'vmx') {
                await refreshVmxScript(root, installation, w4Home);
                vscode.window.showInformationMessage('W4Studica is up to date. VMX build integration was refreshed: build stays local, and SDK fetch runs during deploy.');
            } else { vscode.window.showInformationMessage('W4Studica is already up to date.'); }
            return;
        }
        await configureProject(root, installation, target, w4Home);
        vscode.window.showInformationMessage('W4Studica updated: GradleRIO ' + installation.gradlerio.manifest.version + ', WPILib ' + installation.allwpilib.manifest.version + '. Run Save W4Studica Offline to refresh offline dependencies.');
    });
    command('saveOffline', async (folder, progress) => {
        const root = folder.uri.fsPath;
        const w4Home = path.join(os.homedir(), 'wpilib', '2027', 'W4Studica');
        let state = await readState(root, w4Home);
        if (!state) { throw new Error('Run Update W4Studica Version or change the deploy target first.'); }
        if (detectTarget(await io.readFile(path.join(root, 'build.gradle'), 'utf8')) !== state.target) {
            throw new Error('The deploy target changed outside W4Studica. Run Update W4Studica Version to reconnect this project before saving offline.');
        }
        if (state.schemaVersion !== 2 || !installationIsInWpilibHome(state.installation, w4Home)) {
            const installation = await install(folder, progress);
            await configureProject(root, installation, state.target, w4Home);
            state = await readState(root, w4Home);
            if (!state) { throw new Error('Could not save W4Studica project settings.'); }
        }
        await saveOffline(root, state, text => output.appendLine(text));
        vscode.window.showInformationMessage('W4Studica saved for offline use. Later project builds will use the saved dependencies. Re-run this command after changing dependencies.');
    });
    context.subscriptions.push(vscode.commands.registerCommand('vmxpi-wsr.openCommandPalette', () => vscode.commands.executeCommand('workbench.action.quickOpen', '>W4Studica: ')));
}

export function deactivate(): void { /* VS Code disposes registered commands and the output channel. */ }
