import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrivateKey } from '@bsv/sdk';
import { analyzeBuildDirectory } from './analyzer.js';
import { createUrlMap, rewriteFile } from './rewriter.js';
import { inscribeFile } from './inscriber.js';
import type {
  DeploymentConfig,
  DeploymentResult,
  DeploymentManifest,
  InscribedFile,
  FileReference,
} from './types.js';

export interface OrchestratorCallbacks {
  onAnalysisStart?: () => void;
  onAnalysisComplete?: (fileCount: number) => void;
  onInscriptionStart?: (file: string, current: number, total: number) => void;
  onInscriptionComplete?: (file: string, url: string) => void;
  onDeploymentComplete?: (entryPointUrl: string) => void;
}

/**
 * Main deployment orchestrator
 */
export async function deployToChain(
  config: DeploymentConfig,
  callbacks?: OrchestratorCallbacks
): Promise<DeploymentResult> {
  const { buildDir, paymentKey, destinationAddress, satsPerKb, dryRun } = config;

  // Parse payment key (skip in dry-run mode)
  let paymentPk: PrivateKey;
  if (dryRun) {
    // Use a valid dummy key for dry-run mode
    paymentPk = PrivateKey.fromRandom();
  } else {
    paymentPk = PrivateKey.fromWif(paymentKey);
  }

  // Step 1: Analyze the build directory
  callbacks?.onAnalysisStart?.();
  const { files, graph, order } = await analyzeBuildDirectory(buildDir);
  callbacks?.onAnalysisComplete?.(files.length);

  if (files.length === 0) {
    throw new Error(`No files found in build directory: ${buildDir}`);
  }

  // Step 2: Process files in topological order
  const inscriptions: InscribedFile[] = [];
  const urlMap = new Map<string, string>();
  let totalCost = 0;
  let totalSize = 0;
  const txids = new Set<string>();
  let changeUtxo: any = undefined; // Track change from previous inscription

  for (let i = 0; i < order.length; i++) {
    const filePath = order[i];
    const node = graph.get(filePath);

    if (!node) continue;

    const fileRef = node.file;
    const absolutePath = fileRef.absolutePath;

    callbacks?.onInscriptionStart?.(filePath, i + 1, order.length);

    // Check if this file has dependencies that have been inscribed
    const hasDependencies = fileRef.dependencies.length > 0;
    let content: string | undefined;

    if (hasDependencies) {
      // Rewrite the file content to use ordfs URLs
      content = await rewriteFile(
        absolutePath,
        buildDir,
        filePath,
        fileRef.contentType,
        urlMap
      );
    }

    // Inscribe the file (or simulate in dry-run mode)
    // Pass the change UTXO from the previous transaction (if any)
    const result = await inscribeFile(
      absolutePath,
      filePath,
      fileRef.contentType,
      destinationAddress,
      paymentPk,
      content,
      satsPerKb,
      dryRun,
      changeUtxo
    );

    inscriptions.push(result.inscription);
    urlMap.set(filePath, result.inscription.url);
    txids.add(result.inscription.txid);

    // Update change UTXO for next iteration
    changeUtxo = result.changeUtxo;

    // Track total size
    totalSize += result.inscription.size;

    callbacks?.onInscriptionComplete?.(filePath, result.inscription.url);

    // Estimate cost (rough approximation)
    totalCost += Math.ceil((result.inscription.size + 200) / 1000 * (satsPerKb || 50)) + 1;

    // Small delay between inscriptions (only needed if NOT using change UTXO)
    if (i < order.length - 1 && !changeUtxo) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Find the entry point (index.html)
  const entryPoint = inscriptions.find(
    i => i.originalPath === 'index.html' || i.originalPath.endsWith('/index.html')
  );

  if (!entryPoint) {
    throw new Error('No index.html found in build directory');
  }

  callbacks?.onDeploymentComplete?.(entryPoint.url);

  return {
    entryPointUrl: entryPoint.url,
    inscriptions,
    totalCost,
    totalSize,
    txids: Array.from(txids),
  };
}

/**
 * Generates a deployment manifest file
 */
export function generateManifest(result: DeploymentResult): DeploymentManifest {
  return {
    timestamp: new Date().toISOString(),
    entryPoint: result.entryPointUrl,
    files: result.inscriptions,
    totalFiles: result.inscriptions.length,
    totalCost: result.totalCost,
    totalSize: result.totalSize,
    transactions: result.txids,
  };
}

/**
 * Saves the deployment manifest to a file
 */
export async function saveManifest(
  manifest: DeploymentManifest,
  outputPath: string
): Promise<void> {
  const json = JSON.stringify(manifest, null, 2);
  await writeFile(outputPath, json, 'utf-8');
}
