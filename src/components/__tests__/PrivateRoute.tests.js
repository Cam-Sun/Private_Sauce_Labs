import React from 'react';
import { ROUTES } from '../../../src/utils/Constants';

// Use require to allow jest module mocking
jest.mock('../../../src/utils/Credentials', () => ({
  isLoggedIn: jest.fn(),
}));

const { isLoggedIn } = require('../../../src/utils/Credentials');
const PrivateRoute = require('../PrivateRoute').default;
const ReactRouter = require('react-router-dom');

function getRenderPropElement(props = {}) {
  // PrivateRoute returns a <Route ... render={(props) => ...} />
  const element = PrivateRoute({ component: props.component || (() => <div data-test="inner" />), ...props });
  // element is a React element for Route; its props.render is the render prop
  return element.props.render;
}

describe('PrivateRoute', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('renders component when logged in', () => {
    isLoggedIn.mockReturnValue(true);
    // Use a named component so we can assert the returned element type
    const Inner = () => <div />;
    const renderProp = getRenderPropElement({ component: Inner });

    const props = { location: { pathname: '/foo' } };
    const result = renderProp(props);
    // result should be a React element of type Inner
    expect(result.type).toBe(Inner);
  });

  test('redirects to login when not logged in', () => {
    isLoggedIn.mockReturnValue(false);
    const renderProp = getRenderPropElement();

    const props = { location: { pathname: '/bar' } };
    const result = renderProp(props);
    // result should be a Redirect element
    expect(result.type).toBe(ReactRouter.Redirect);
    expect(result.props.to.pathname).toBe(ROUTES.LOGIN);
    expect(result.props.to.state.from).toBe(props.location);
  });
});
