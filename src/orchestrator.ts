import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrivateKey } from '@bsv/sdk';
import { analyzeBuildDirectory } from './analyzer.js';
import {
  createUrlMap,
  rewriteFile,
  injectVersionScript,
  injectServiceResolverScript,
} from './rewriter.js';
import { inscribeFile } from './inscriber.js';
import {
  deployVersioningContract,
  addVersionToContract,
  updateContractOrigin,
  VERSIONING_ENABLED,
} from './versioningContractHandler.js';
import {
  getAllOrdinalContentServices,
  getAllOrdinalIndexers,
  config as envConfig,
} from './config.js';
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
  const {
    buildDir,
    paymentKey,
    destinationAddress,
    satsPerKb,
    dryRun,
    enableVersioning,
    version,
    versionDescription,
    versioningContract,
    appName,
    ordinalContentUrl,
    ordinalIndexerUrl,
    enableServiceResolver,
  } = config;

  // Get service URLs (use config override or fall back to env/defaults)
  const primaryContentUrl = ordinalContentUrl || envConfig.ordinalContentUrl;
  const primaryIndexerUrl = ordinalIndexerUrl || envConfig.ordinalIndexerUrl;
  const shouldEnableServiceResolver = enableServiceResolver ?? envConfig.enableServiceResolver;

  // Get all known services for fallback
  const allContentServices = getAllOrdinalContentServices(primaryContentUrl);
  const allIndexers = getAllOrdinalIndexers(primaryIndexerUrl);

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

  // Step 1.5: Handle versioning contract deployment (if needed)
  let finalVersioningContract = versioningContract;
  let changeUtxo: any = undefined; // Track change from previous transaction

  if (enableVersioning && version) {
    if (dryRun) {
      // DRY RUN MODE - Create mock versioning contract
      if (!versioningContract) {
        // Generate a mock contract outpoint for testing
        const mockContractTxid = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';
        finalVersioningContract = `${mockContractTxid}_0`;
        console.log('📝 Mock versioning contract created:', finalVersioningContract);
        console.log('    (dry-run mode - no actual contract deployed)');
      }
    } else {
      // REAL MODE - Deploy actual versioning contract
      if (!VERSIONING_ENABLED) {
        console.warn('⚠️  Versioning is enabled but scrypt-ts integration is not complete.');
        console.warn('   The versioning contract will not be deployed/updated.');
        console.warn('   See versioningContractHandler.ts for implementation details.');
      } else if (!versioningContract) {
        // First deployment - need to deploy versioning contract
        console.log('📝 Deploying versioning contract...');

        // We don't have the entry point yet, so we'll use a placeholder
        // The actual entry point will be updated after inscription
        const placeholderOrigin = 'pending';

        try {
          const result = await deployVersioningContract(
            paymentPk,
            destinationAddress,
            placeholderOrigin,
            appName || 'ReactApp',
            satsPerKb
          );
          finalVersioningContract = result.contractOutpoint;

          console.log(`✅ Versioning contract deployed: ${finalVersioningContract}`);
        } catch (error) {
          console.error('❌ Failed to deploy versioning contract:', error);
          throw error;
        }
      }
    }
  }

  // Step 2: Process files in topological order
  const inscriptions: InscribedFile[] = [];
  const urlMap = new Map<string, string>();
  let totalCost = 0;
  let totalSize = 0;
  const txids = new Set<string>();
  // changeUtxo is initialized above (either from contract deployment or undefined)

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
      content = await rewriteFile(absolutePath, buildDir, filePath, fileRef.contentType, urlMap);
    }

    // Inject scripts into index.html if needed
    const isIndexHtml = filePath === 'index.html' || filePath.endsWith('/index.html');
    if (isIndexHtml) {
      // Read the HTML content if not already read
      if (!content) {
        content = await readFile(absolutePath, 'utf-8');
      }

      // Inject service resolver script if enabled
      if (shouldEnableServiceResolver) {
        content = await injectServiceResolverScript(content, allContentServices, primaryContentUrl);
      }

      // Inject version script if versioning is enabled
      if (enableVersioning && finalVersioningContract) {
        // Extract origin outpoint from entry point URL after inscription
        // For first deployment, we'll use a placeholder that gets updated by the script
        const originPlaceholder = dryRun ? 'MOCK_ORIGIN_' + Date.now() : 'ORIGIN_' + Date.now();

        // Inject the version redirect script
        content = await injectVersionScript(
          content,
          finalVersioningContract,
          originPlaceholder,
          allIndexers,
          allContentServices
        );

        if (dryRun) {
          console.log('📝 Version redirect script injected (dry-run mode)');
        }
      }
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
      changeUtxo,
      primaryContentUrl
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
    totalCost += Math.ceil(((result.inscription.size + 200) / 1000) * (satsPerKb || 50)) + 1;

    // Small delay between inscriptions (only needed if NOT using change UTXO)
    if (i < order.length - 1 && !changeUtxo) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Find the entry point (index.html)
  const entryPoint = inscriptions.find(
    (i) => i.originalPath === 'index.html' || i.originalPath.endsWith('/index.html')
  );

  if (!entryPoint) {
    throw new Error('No index.html found in build directory');
  }

  // Step 3: Update contract origin if it's "pending" (only for first deployment)
  if (enableVersioning && finalVersioningContract && !dryRun && !versioningContract) {
    if (VERSIONING_ENABLED) {
      console.log('📝 Updating contract origin...');

      try {
        const entryPointOutpoint =
          entryPoint.url.split('/').pop() || entryPoint.txid + '_' + entryPoint.vout;
        await updateContractOrigin(
          finalVersioningContract,
          paymentPk,
          entryPointOutpoint,
          satsPerKb
        );
        console.log(`✅ Contract origin updated`);
      } catch (error) {
        console.error('❌ Failed to update contract origin:', error);
        // Don't throw - deployment was successful, origin update is not critical
        console.warn('⚠️  Deployment succeeded but origin was not updated');
      }
    }
  }

  // Step 4: Add version to contract (if versioning enabled)
  if (enableVersioning && version && finalVersioningContract && !dryRun) {
    if (VERSIONING_ENABLED) {
      console.log('📝 Adding version to contract...');

      try {
        await addVersionToContract(
          finalVersioningContract,
          paymentPk,
          version,
          entryPoint.url.split('/').pop() || entryPoint.txid + '_' + entryPoint.vout,
          versionDescription || `Version ${version}`,
          satsPerKb
        );
        console.log(`✅ Version ${version} added to contract`);
      } catch (error) {
        console.error('❌ Failed to add version to contract:', error);
        // Don't throw - deployment was successful, just version tracking failed
        console.warn('⚠️  Deployment succeeded but version was not tracked on-chain');
      }
    }
  }

  callbacks?.onDeploymentComplete?.(entryPoint.url);

  return {
    entryPointUrl: entryPoint.url,
    inscriptions,
    totalCost,
    totalSize,
    txids: Array.from(txids),
    versioningContract: finalVersioningContract,
    version: version,
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
    versioningContract: result.versioningContract,
    version: result.version,
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
