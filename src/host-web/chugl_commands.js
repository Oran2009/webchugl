/**
 * ChuGL Command Serialization for Web Audio Worklet
 *
 * This module provides command types and serialization for sending
 * ChuGL commands from the Audio Worklet to the main thread.
 */

// Command type enum (matching sg_command.h)
const SG_CommandType = {
    // Configuration
    SET_FIXED_TIMESTEP: 1,

    // Window
    WINDOW_CLOSE: 10,
    WINDOW_MODE: 11,
    WINDOW_SIZE_LIMITS: 12,
    WINDOW_POSITION: 13,
    WINDOW_TITLE: 14,

    // Mouse
    MOUSE_MODE: 20,

    // Transform/Hierarchy
    CREATE_XFORM: 30,
    ADD_CHILD: 31,
    REMOVE_CHILD: 32,
    SET_POSITION: 33,
    SET_ROTATION: 34,
    SET_SCALE: 35,
    COMPONENT_FREE: 36,

    // Geometry
    GEO_CREATE: 40,
    GEO_SET_VERTEX_ATTRIBUTE: 41,
    GEO_SET_VERTEX_COUNT: 42,
    GEO_SET_INDICES: 43,

    // Texture
    TEXTURE_CREATE: 50,
    TEXTURE_WRITE: 51,
    TEXTURE_FROM_FILE: 52,

    // Shader/Material
    SHADER_CREATE: 60,
    MATERIAL_CREATE: 61,
    MATERIAL_UPDATE_PSO: 62,
    MATERIAL_SET_UNIFORM: 63,

    // Mesh
    MESH_UPDATE: 70,

    // Camera
    CAMERA_CREATE: 80,
    CAMERA_SET_PARAMS: 81,

    // Scene
    SCENE_UPDATE: 90,

    // Pass
    PASS_CREATE: 100,
    PASS_UPDATE: 101,
    PASS_CONNECT: 102,

    // Light
    LIGHT_UPDATE: 110,

    // Text
    TEXT_REBUILD: 120,
};

/**
 * Command Queue for serializing ChuGL commands
 */
class CommandQueue {
    constructor() {
        this.commands = [];
        this.nextId = 1;
    }

    /**
     * Generate a unique ID for new objects
     */
    generateId() {
        return this.nextId++;
    }

    /**
     * Push a command to the queue
     */
    push(type, data) {
        this.commands.push({ type, ...data });
    }

    /**
     * Get all commands and clear the queue
     * Returns a transferable object for postMessage
     */
    flush() {
        const cmds = this.commands;
        this.commands = [];
        return cmds;
    }

    /**
     * Check if queue has commands
     */
    hasCommands() {
        return this.commands.length > 0;
    }

    // ========================================================================
    // Transform Commands
    // ========================================================================

    createTransform(parentId = 0) {
        const id = this.generateId();
        this.push(SG_CommandType.CREATE_XFORM, { id, parentId });
        return id;
    }

    setPosition(id, x, y, z) {
        this.push(SG_CommandType.SET_POSITION, { id, pos: [x, y, z] });
    }

    setRotation(id, x, y, z, w) {
        this.push(SG_CommandType.SET_ROTATION, { id, rot: [x, y, z, w] });
    }

    setScale(id, x, y, z) {
        this.push(SG_CommandType.SET_SCALE, { id, scale: [x, y, z] });
    }

    addChild(parentId, childId) {
        this.push(SG_CommandType.ADD_CHILD, { parentId, childId });
    }

    removeChild(parentId, childId) {
        this.push(SG_CommandType.REMOVE_CHILD, { parentId, childId });
    }

    freeComponent(id) {
        this.push(SG_CommandType.COMPONENT_FREE, { id });
    }

    // ========================================================================
    // Geometry Commands
    // ========================================================================

    createGeometry(geoType) {
        const id = this.generateId();
        this.push(SG_CommandType.GEO_CREATE, { id, geoType });
        return id;
    }

    setVertexAttribute(geoId, attrType, data) {
        // data should be Float32Array
        this.push(SG_CommandType.GEO_SET_VERTEX_ATTRIBUTE, {
            id: geoId,
            attrType,
            data: Array.from(data) // Convert to regular array for JSON
        });
    }

    setVertexCount(geoId, count) {
        this.push(SG_CommandType.GEO_SET_VERTEX_COUNT, { id: geoId, count });
    }

    setIndices(geoId, indices) {
        this.push(SG_CommandType.GEO_SET_INDICES, {
            id: geoId,
            indices: Array.from(indices)
        });
    }

    // ========================================================================
    // Texture Commands
    // ========================================================================

    createTexture(width, height, format) {
        const id = this.generateId();
        this.push(SG_CommandType.TEXTURE_CREATE, { id, width, height, format });
        return id;
    }

    textureFromFile(filepath) {
        const id = this.generateId();
        this.push(SG_CommandType.TEXTURE_FROM_FILE, { id, filepath });
        return id;
    }

    textureWrite(texId, data, x, y, width, height) {
        this.push(SG_CommandType.TEXTURE_WRITE, {
            id: texId,
            data: Array.from(data),
            x, y, width, height
        });
    }

    // ========================================================================
    // Material Commands
    // ========================================================================

    createMaterial(shaderType) {
        const id = this.generateId();
        this.push(SG_CommandType.MATERIAL_CREATE, { id, shaderType });
        return id;
    }

    setUniform(matId, location, type, value) {
        this.push(SG_CommandType.MATERIAL_SET_UNIFORM, {
            id: matId,
            location,
            type,
            value
        });
    }

    // ========================================================================
    // Mesh Commands
    // ========================================================================

    updateMesh(meshId, geoId, matId) {
        this.push(SG_CommandType.MESH_UPDATE, { id: meshId, geoId, matId });
    }

    // ========================================================================
    // Camera Commands
    // ========================================================================

    createCamera() {
        const id = this.generateId();
        this.push(SG_CommandType.CAMERA_CREATE, { id });
        return id;
    }

    setCameraParams(camId, params) {
        this.push(SG_CommandType.CAMERA_SET_PARAMS, { id: camId, ...params });
    }

    // ========================================================================
    // Scene Commands
    // ========================================================================

    updateScene(sceneId, params) {
        this.push(SG_CommandType.SCENE_UPDATE, { id: sceneId, ...params });
    }

    // ========================================================================
    // Light Commands
    // ========================================================================

    updateLight(lightId, params) {
        this.push(SG_CommandType.LIGHT_UPDATE, { id: lightId, ...params });
    }

    // ========================================================================
    // Pass Commands
    // ========================================================================

    createPass(passType) {
        const id = this.generateId();
        this.push(SG_CommandType.PASS_CREATE, { id, passType });
        return id;
    }

    updatePass(passId, params) {
        this.push(SG_CommandType.PASS_UPDATE, { id: passId, ...params });
    }

    connectPass(passId, nextPassId) {
        this.push(SG_CommandType.PASS_CONNECT, { id: passId, nextId: nextPassId });
    }
}

// Export for use in Audio Worklet
if (typeof module !== 'undefined') {
    module.exports = { SG_CommandType, CommandQueue };
}
