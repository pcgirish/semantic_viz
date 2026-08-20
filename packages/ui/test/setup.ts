import "@testing-library/jest-dom/vitest";

// jsdom does not implement HTMLCanvasElement.getContext, and its "not implemented" report
// goes to the virtual console as an error, which vitest fails the test on. Returning null
// instead is what a real browser does when a context cannot be created, and it drives
// Canvas3dHost down the same no-WebGL branch it takes on an unsupported browser.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
