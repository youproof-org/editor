import * as fs from 'fs';
import * as vscode from 'vscode';

// The content repo's dev install symlinks media/ into the extensions folder, and VS Code
// refuses a webview resource whose real path is outside the webview's localResourceRoots.
export function mediaRoot(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.file(fs.realpathSync(vscode.Uri.joinPath(context.extensionUri, 'media').fsPath));
}
