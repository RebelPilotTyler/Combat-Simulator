export interface Battlefield3DProjectionOptions {
  gridWidth: number;
  gridHeight: number;
  svgWidth: number;
  svgHeight: number;
  cellSize: number;
  cameraYaw: number;
  cameraPitch: number;
  cameraZoom: number;
  cameraPanX: number;
  cameraPanY: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

export interface ProjectedTileCorners {
  northWest: ProjectedPoint;
  northEast: ProjectedPoint;
  southEast: ProjectedPoint;
  southWest: ProjectedPoint;
}

export interface Battlefield3DProjection {
  projectPoint: (x: number, y: number, z: number) => ProjectedPoint;
  getProjectedDepth: (x: number, y: number) => number;
  projectTileCorners: (x: number, y: number, z: number) => ProjectedTileCorners;
}

export function createBattlefield3DProjection(
  options: Battlefield3DProjectionOptions
): Battlefield3DProjection {
  const unitSize = options.cellSize * 1.16 * options.cameraZoom;
  const yawRadians = (options.cameraYaw * Math.PI) / 180;
  const pitchRadians = (options.cameraPitch * Math.PI) / 180;
  const pitchScale = Math.max(0.38, Math.sin(pitchRadians));
  const zScale = 0.72;

  const projectPoint = (x: number, y: number, z: number): ProjectedPoint => {
    const centeredX = x - options.gridWidth / 2;
    const centeredY = y - options.gridHeight / 2;
    const rotatedX = centeredX * Math.cos(yawRadians) - centeredY * Math.sin(yawRadians);
    const rotatedY = centeredX * Math.sin(yawRadians) + centeredY * Math.cos(yawRadians);

    return {
      x: options.svgWidth / 2 + rotatedX * unitSize + options.cameraPanX,
      y: options.svgHeight / 2 + rotatedY * unitSize * pitchScale - z * unitSize * zScale + options.cameraPanY,
      depth: rotatedY + z * 0.35
    };
  };

  const getProjectedDepth = (x: number, y: number): number => {
    const centeredX = x - options.gridWidth / 2;
    const centeredY = y - options.gridHeight / 2;
    return centeredX * Math.sin(yawRadians) + centeredY * Math.cos(yawRadians);
  };

  const projectTileCorners = (x: number, y: number, z: number): ProjectedTileCorners => {
    const inset = 0.045;
    return {
      northWest: projectPoint(x + inset, y + inset, z),
      northEast: projectPoint(x + 1 - inset, y + inset, z),
      southEast: projectPoint(x + 1 - inset, y + 1 - inset, z),
      southWest: projectPoint(x + inset, y + 1 - inset, z)
    };
  };

  return { projectPoint, getProjectedDepth, projectTileCorners };
}
