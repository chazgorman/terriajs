"use strict";

import createReactClass from "create-react-class";
import { runInAction } from "mobx";
import { observer } from "mobx-react";
import PropTypes from "prop-types";
import { Range } from "rc-slider";
import React from "react";
import CommonStrata from "../../../Models/CommonStrata";
import ObserveModelMixin from "../../ObserveModelMixin";
import Styles from "./filter-section.scss";

const FilterSection = observer(
  createReactClass({
    displayName: "FilterSection",
    mixins: [ObserveModelMixin],

    propTypes: {
      item: PropTypes.object.isRequired
    },

    change(filter, values) {
      runInAction(() => {
        filter.setTrait(CommonStrata.user, "minimumShown", values[0]);
        filter.setTrait(CommonStrata.user, "maximumShown", values[1]);
      });
      this.props.item.terria.currentViewer.notifyRepaintRequired();
    },

    render() {
      const item = this.props.item;
      if (!item.filters || item.filters.length === 0) {
        return null;
      }
      return (
        <div className={Styles.filters}>
          {item.filters.map(this.renderFilter)}
        </div>
      );
    },

    renderFilter(filter) {
      const values = [filter.minimumShown, filter.maximumShown];
      return (
        <div key={filter.property} className={Styles.filter}>
          <label htmlFor={filter.property}>
            Show {filter.name}: {filter.minimumShown} to {filter.maximumShown}
          </label>
          <Range
            value={values}
            allowCross={false}
            min={filter.minimumValue}
            max={filter.maximumValue}
            onChange={this.change.bind(this, filter)}
          />
        </div>
      );
    }
  })
);
module.exports = FilterSection;
