GSuzanne cube --> GG.scene(); // connect a cube to the scene
cube.pos(@(0,0,0)); // set cube's position to xyz coordinate (1,2,3)
cube.scaX(1); // double the cube's width along the x axis
cube.color(@(1, 0, 1));  // make the cube red

// get the default directional light
GG.scene().light() @=> GLight light;

// lights are GGens, so we can manipulate them using the same methods
light.rotateZ(Math.PI); // rotate the light downwards by PI radians

// make light half as bright
5 => light.intensity;

// change light color
Color.RED => light.color;

while (true) {
    GG.nextFrame() => now;
    GG.dt() => cube.rotateY; // rotate the cube on its y axis
}