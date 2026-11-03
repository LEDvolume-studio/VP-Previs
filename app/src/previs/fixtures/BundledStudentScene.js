// Local integration fixtures only. These files are not a published teacher catalogue.
const definitions = {
	"suv": {
		"source": "/vehicles/mid-suv/mid-suv.glb",
		"sha256": "38bdd5dcbf6be692ecf8dd7d6c0bca44c060234836fa8eba012e979eed9597bc",
		"byteLength": 19432020,
		"nodeNames": [
			"KB3D_CEV_VehicMidSUV_A_FrontDoorL",
			"FrontDoor_left_Hinge",
			"KB3D_CEV_VehicMidSUV_A_FrontDoorR",
			"FrontDoor_right_Hinge",
			"KB3D_CEV_VehicMidSUV_A_Body",
			"KB3D_CEV_VehicMidSUV_A_FrontWheelL",
			"KB3D_CEV_VehicMidSUV_A_FrontWheelR",
			"KB3D_CEV_VehicMidSUV_A_Hatch",
			"KB3D_CEV_VehicMidSUV_A_RearDoorL",
			"KB3D_CEV_VehicMidSUV_A_RearDoorR",
			"KB3D_CEV_VehicMidSUV_A_RearWheelL",
			"KB3D_CEV_VehicMidSUV_A_RearWheelR",
			"KB3D_CEV_VehicMidSUV_A_Shifter",
			"KB3D_CEV_VehicMidSUV_A_SteeringWheel",
			"KB3D_CEV_VehicMidSUV_A_SuspensionFront",
			"KB3D_CEV_VehicMidSUV_A_SuspensionRear",
			"KB3D_CEV_VehicMidSUV_A_WiperA",
			"KB3D_CEV_VehicMidSUV_A_WiperB",
			"KB3D_CEV_VehicMidSUV_A_WiperC",
			"KB3D_Mid_SUV"
		]
	},
	"mannequin": {
		"source": "/characters/mannequin/mannequin-presets.glb",
		"sha256": "a494718adecba5ac662b199af944de2d60368bc3f8498c7664c82d400624bf12",
		"byteLength": 1787740,
		"nodeNames": [
			"DEF-toe.L",
			"DEF-foot.L",
			"DEF-shin.L.001",
			"DEF-shin.L",
			"DEF-thigh.L.001",
			"DEF-thigh.L",
			"DEF-toe.R",
			"DEF-foot.R",
			"DEF-shin.R.001",
			"DEF-shin.R",
			"DEF-thigh.R.001",
			"DEF-thigh.R",
			"DEF-shoulder.L",
			"DEF-f_index.03.L",
			"DEF-f_index.02.L",
			"DEF-f_index.01.L",
			"DEF-palm.01.L",
			"DEF-thumb.03.L",
			"DEF-thumb.02.L",
			"DEF-thumb.01.L",
			"DEF-f_middle.03.L",
			"DEF-f_middle.02.L",
			"DEF-f_middle.01.L",
			"DEF-palm.02.L",
			"DEF-f_ring.03.L",
			"DEF-f_ring.02.L",
			"DEF-f_ring.01.L",
			"DEF-palm.03.L",
			"DEF-f_pinky.03.L",
			"DEF-f_pinky.02.L",
			"DEF-f_pinky.01.L",
			"DEF-palm.04.L",
			"DEF-hand.L",
			"DEF-forearm.L.001",
			"DEF-forearm.L",
			"DEF-upper_arm.L.001",
			"DEF-upper_arm.L",
			"DEF-shoulder.R",
			"DEF-f_index.03.R",
			"DEF-f_index.02.R",
			"DEF-f_index.01.R",
			"DEF-palm.01.R",
			"DEF-thumb.03.R",
			"DEF-thumb.02.R",
			"DEF-thumb.01.R",
			"DEF-f_middle.03.R",
			"DEF-f_middle.02.R",
			"DEF-f_middle.01.R",
			"DEF-palm.02.R",
			"DEF-f_ring.03.R",
			"DEF-f_ring.02.R",
			"DEF-f_ring.01.R",
			"DEF-palm.03.R",
			"DEF-f_pinky.03.R",
			"DEF-f_pinky.02.R",
			"DEF-f_pinky.01.R",
			"DEF-palm.04.R",
			"DEF-hand.R",
			"DEF-forearm.R.001",
			"DEF-forearm.R",
			"DEF-upper_arm.R.001",
			"DEF-upper_arm.R",
			"DEF-spine.006",
			"DEF-spine.005",
			"DEF-spine.004",
			"DEF-spine.003",
			"DEF-spine.002",
			"DEF-spine.001",
			"DEF-spine",
			"Rayzee_Mannequin",
			"Rigged Human Mannequin man (Rigify)"
		]
	},
	"led": {
		"source": "/models/led/main-led-volume-wall.glb",
		"sha256": "8b5b9f5fc6ee7dd399f77ee4c64c05adda6e6b0ae4637f7f6e11eeb3c7e26ea3",
		"byteLength": 8680,
		"nodeNames": [
			"QuadWall"
		]
	},
	"studio": {
		"source": "/models/studio-one.glb",
		"sha256": "50142c830a08716d107aa2ea94e166b1b292b52b943ee79d81bdc7c548a5ff8d",
		"byteLength": 396084,
		"nodeNames": [
			""
		]
	}
};

/** Fresh detached runtime manifest; only assets/baseScene belong in portable JSON. */
export function createBundledStudentSceneManifest( { models = [ 'suv', 'mannequin', 'led' ] } = {} ) {

	if ( ! Array.isArray( models ) || ! models.length || new Set( models ).size !== models.length || models.some( key => ! Object.hasOwn( definitions, key ) ) ) throw new Error( 'Select unique known local fixture models.' );
	const assets = {};
	const preparedModels = models.map( key => {

		const definition = definitions[ key ];
		const asset = { assetId: `local-fixture-${key}`, version: 'fixture-1' };
		assets[ `${asset.assetId}@${asset.version}` ] = { ...asset, kind: 'model', sha256: definition.sha256, byteLength: definition.byteLength, mimeType: 'model/gltf-binary', durationUs: null };
		return {
			asset, source: definition.source,
			nodes: [
				{ instanceId: `${key}-root`, nodeId: `${key}-root`, gltfNodeIndex: null, expectedName: null },
				...definition.nodeNames.map( ( expectedName, gltfNodeIndex ) => ( { instanceId: `${key}-instance-${gltfNodeIndex}`, nodeId: `${key}-node-${gltfNodeIndex}`, gltfNodeIndex, expectedName } ) ),
			],
		};

	} );
	return { assets, baseScene: { sceneId: `local-fixture-${[ ...models ].sort().join( '-' )}`, version: 'fixture-1', assets: preparedModels.map( model => ( { ...model.asset } ) ) }, models: preparedModels };

}
