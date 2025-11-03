import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

export const getManifestLatestVersion = async (manifest: string): Promise<string | null> => {
  let manifestLatestVersion: string | null = null;
  if (existsSync(manifest)) {
    const manifestJson = await readFile(manifest, 'utf-8');
    const manifestData = JSON.parse(manifestJson);
    if ('manifestVersion' in manifestData && 'deployments' in manifestData) {
      const latestDeployment = manifestData.deployments[manifestData.deployments.length - 1];
      manifestLatestVersion = latestDeployment?.version;
    }
  }
  return manifestLatestVersion;
};
