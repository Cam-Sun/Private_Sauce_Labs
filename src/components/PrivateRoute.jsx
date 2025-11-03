import React from "react";
import { Redirect, Route } from "react-router-dom";
import PropTypes from "prop-types";
import { isLoggedIn } from "../utils/Credentials";
import { ROUTES } from "../utils/Constants";

/**
 * PrivateRoute - renders `component` when `isLoggedIn()` is true, otherwise
 * redirects to LOGIN while preserving the attempted location in location.state
 */
const PrivateRoute = ({ component: Component, ...rest }) => {
  return (
    <Route
      {...rest}
      render={(props) =>
        isLoggedIn() ? (
          <Component {...props} />
        ) : (
          <Redirect
            to={{ pathname: ROUTES.LOGIN, state: { from: props.location } }}
          />
        )
      }
    />
  );
};

PrivateRoute.propTypes = {
  /**
   * A react component (element type)
   */
  component: PropTypes.oneOfType([PropTypes.elementType, PropTypes.func, PropTypes.object]),
};

PrivateRoute.defaultProps = {
  customClass: undefined,
  secondaryHeaderBot: undefined,
  secondaryLeftComponent: undefined,
  secondaryRightComponent: undefined,
  secondaryTitle: undefined,
};

export default PrivateRoute;
