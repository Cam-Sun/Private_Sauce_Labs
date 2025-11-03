// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
// Use only CommonJS `require` here so the polyfill runs before any module imports.
require('./jest.setupTextEncoder.js');

require('@testing-library/jest-dom');
const { configure } = require('enzyme');
const Adapter = require('@wojtekmaj/enzyme-adapter-react-17');

// Register enzyme-to-json serializer after polyfill
expect.addSnapshotSerializer(require('enzyme-to-json/serializer'));

configure({ adapter: new Adapter() });
