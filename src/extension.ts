import * as vscode from 'vscode';
import * as path from 'path';
import { findInstallation, Installation, installComponent } from './releases';
import { configureProject, detectTarget, readState, Target } from './project';
import { saveOffline } from './offline';
import { io } from './files';

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

    async function install(folder: vscode.WorkspaceFolder): Promise<Installation> {
        const settings = vscode.workspace.getConfiguration('w4studica', folder.uri);
        const pair = await findInstallation({
            gradlerio: settings.get<string>('gradleRIORepository', 'W4Studica/GradleRIO'),
            allwpilib: settings.get<string>('allwpilibRepository', 'W4Studica/allwpilib')
        }, settings.get<boolean>('includePrereleases', true));
        const storage = context.globalStorageUri.fsPath;
        const log = (text: string) => output.appendLine(text);
        const gradlerio = await installComponent(pair.gradlerio, storage, log);
        const allwpilib = await installComponent(pair.allwpilib, storage, log);
        return { gradlerio, allwpilib };
    }

    function command(id: string, action: (folder: vscode.WorkspaceFolder) => Promise<void>): void {
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
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'W4Studica', cancellable: false }, () => action(folder));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                output.appendLine(message);
                vscode.window.showErrorMessage('W4Studica: ' + message);
            } finally { if (root && acquired) { busy.delete(root); } }
        }));
    }

    async function changeTarget(folder: vscode.WorkspaceFolder, target: Target): Promise<void> {
        const root = folder.uri.fsPath;
        const old = await readState(root);
        const current = detectTarget(await io.readFile(path.join(root, 'build.gradle'), 'utf8'));
        if (current === target && old && old.target === target) { vscode.window.showInformationMessage('The deploy target is already ' + (target === 'vmx' ? 'VMX' : 'SystemCore') + '.'); return; }
        const installation = old ? old.installation : await install(folder);
        await configureProject(root, installation, target);
        vscode.window.showInformationMessage('Deploy target changed to ' + (target === 'vmx' ? 'VMX. Set VMX_USER / VMX_PASSWORD in your environment before deploy.' : 'SystemCore.') + ' Run Save W4Studica Offline again to prepare dependencies for this target.');
    }

    command('setVMXPiTarget', folder => changeTarget(folder, 'vmx'));
    command('setSystemCoreTarget', folder => changeTarget(folder, 'systemcore'));
    command('updateW4Studica', async folder => {
        const root = folder.uri.fsPath;
        const current = await readState(root);
        const installation = await install(folder);
        const target = detectTarget(await io.readFile(path.join(root, 'build.gradle'), 'utf8'));
        if (current && current.target === target && JSON.stringify(current.installation) === JSON.stringify(installation)) {
            vscode.window.showInformationMessage('W4Studica is already up to date.'); return;
        }
        await configureProject(root, installation, target);
        vscode.window.showInformationMessage('W4Studica updated: GradleRIO ' + installation.gradlerio.manifest.version + ', WPILib ' + installation.allwpilib.manifest.version + '. Run Save W4Studica Offline to refresh offline dependencies.');
    });
    command('saveOffline', async folder => {
        const root = folder.uri.fsPath;
        const state = await readState(root);
        if (!state) { throw new Error('Run Update W4Studica Version or change the deploy target first.'); }
        if (detectTarget(await io.readFile(path.join(root, 'build.gradle'), 'utf8')) !== state.target) {
            throw new Error('The deploy target changed outside W4Studica. Run Update W4Studica Version to reconnect this project before saving offline.');
        }
        await saveOffline(root, state, text => output.appendLine(text));
        vscode.window.showInformationMessage('W4Studica saved for offline use. The project wrapper now uses offline mode. Re-run this command after changing dependencies.');
    });
    context.subscriptions.push(vscode.commands.registerCommand('vmxpi-wsr.openCommandPalette', () => vscode.commands.executeCommand('workbench.action.quickOpen', '>W4Studica: ')));
}

export function deactivate(): void { /* VS Code disposes registered commands and the output channel. */ }
