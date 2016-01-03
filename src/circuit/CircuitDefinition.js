import GateColumn from "src/circuit/GateColumn.js"
import Gates from "src/ui/Gates.js"
import Matrix from "src/math/Matrix.js"
import Point from "src/math/Point.js"
import Seq from "src/base/Seq.js"
import Util from "src/base/Util.js"

class CircuitDefinition {
    /**
     * @param {!int} numWires
     * @param {!Array<!GateColumn>} columns
     * @property {!int} numWires
     * @property {!Array<!GateColumn>} columns;
     */
    constructor(numWires, columns) {
        Util.need(numWires >= 0, "numWires >= 0");
        Util.need(columns.every(e => e instanceof GateColumn), "columns.every(e => e instanceof GateColumn)");
        Util.need(columns.every(e => e.gates.length === numWires), "columns.every(e => e.gates.length === numWires)");
        this.numWires = numWires;
        this.columns = columns;
    }

    /**
     * @returns {!boolean}
     */
    isTimeDependent() {
        return new Seq(this.columns).any(
                e => new Seq(e.gates).any(
                    g => g !== null && g.isTimeBased()));
    }

    /**
     * @param {!Array.<!Array.<?Gate>>} gates
     * @return {!CircuitDefinition}
     */
    static from(gates) {
        if (gates.length === 0) {
            return new CircuitDefinition(0, []);
        }
        return new CircuitDefinition(gates[0].length, gates.map(c => new GateColumn(c)));
    }

    withColumns(columns) {
        return new CircuitDefinition(
            this.numWires,
            columns)
    }

    withoutEmpties() {
        return new CircuitDefinition(
            this.numWires,
            this.columns.filter(e => !e.isEmpty()));
    }

    withWireCount(newWireCount) {
        if (newWireCount === this.numWires) {
            return this;
        }
        return new CircuitDefinition(
            newWireCount,
            this.columns.map(c => new GateColumn(
                new Seq(c.gates).
                    take(newWireCount).
                    padded(newWireCount, null).
                    toArray())));
    }

    /**
     * Determines at what point each wire is measured (if ever).
     * @returns {!Array.<int>}
     */
    wireMeasuredColumns() {
        if (this.__cachedMeasureIndices === undefined) {
            this.__cachedMeasureIndices = Seq.
                range(this.numWires).
                map(r => Seq.
                    range(this.columns.length).
                    skipWhile(c => this.columns[c].gates[r] !== Gates.Named.Special.Measurement ||
                        this.colHasControls(c)).
                    first(Infinity)).
                toArray();
        }
        return this.__cachedMeasureIndices;
    }

    isEqualTo(other) {
        if (this === other) {
            return true;
        }
        return other instanceof CircuitDefinition &&
            this.numWires === other.numWires &&
            new Seq(this.columns).isEqualTo(new Seq(other.columns), Util.CUSTOM_IS_EQUAL_TO_EQUALITY);
    }

    /**
     * @param {!Point} pt
     * @returns {boolean}
     */
    locIsMeasured(pt) {
        return this.wireMeasuredColumns()[pt.y] <= pt.x;
    }

    /**
     * @param {!Point} pt
     * @returns {!Gate|null}
     */
    gateAtLoc(pt) {
        if (pt.x < 0 || pt.x >= this.columns.length || pt.y < 0 || pt.y >= this.numWires) {
            return null;
        }
        return this.columns[pt.x].gates[pt.y];
    }

    /**
     * @param {!Point} pt
     * @returns {boolean}
     */
    locIsControl(pt) {
        let gate = this.gateAtLoc(pt);
        return gate === Gates.Named.Special.Control || gate === Gates.Named.Special.AntiControl;
    }

    /**
     * @param {!Point} pt
     * @returns {boolean}
     */
    locStartsSingleControlWire(pt) {
        return this.locIsControl(pt) &&
            !this.locIsMeasured(pt);
    }

    /**
     * @param {!Point} pt
     * @returns {boolean}
     */
    locStartsDoubleControlWire(pt) {
        return this.locIsControl(pt) &&
            this.locIsMeasured(pt);
    }

    /**
     * @param {int} col
     * @returns {boolean}
     */
    colHasPairedSwapGate(col) {
        let pts = Seq.range(this.numWires).
            map(row => new Point(col, row)).
            filter(pt => this.gateAtLoc(pt) === Gates.Named.Special.SwapHalf);
        return !pts.any(pt => this.gateAtLocIsDisabledReason(pt) !== null) &&
            pts.count() == 2;
    }

    /**
     * @param {!Point} pt
     * @returns {boolean}
     */
    locHasControllableGate(pt) {
        let g = this.gateAtLoc(pt);
        return g !== null &&
            g !== Gates.Named.Special.Control &&
            g !== Gates.Named.Special.AntiControl &&
            g !== Gates.Named.Silly.SPACER &&
            (g !== Gates.Named.Special.SwapHalf || this.colHasPairedSwapGate(pt.x));
    }

    colHasControls(col) {
        return Seq.range(this.numWires).any(row => this.locIsControl(new Point(col, row)));
    }

    /**
     * @param {!int} col
     * @returns {boolean}
     */
    colHasSingleWireControl(col) {
        return Seq.range(this.numWires).any(row => this.locStartsSingleControlWire(new Point(col, row)));
    }

    /**
     * @param {!int} col
     * @returns {boolean}
     */
    colHasDoubleWireControl(col) {
        return Seq.range(this.numWires).any(row => this.locStartsDoubleControlWire(new Point(col, row)));
    }

    /**
     * @param {!Gate} g
     * @returns {boolean}
     * @private
     */
    static _isGateAllowedAfterMeasurement(g) {
        return g === Gates.Named.Special.Control ||
            g === Gates.Named.Special.AntiControl ||
            g === Gates.Named.Special.Tomography ||
            g === Gates.Named.Special.Measurement ||
            g === Gates.Named.Silly.SPACER ||
            g === Gates.Named.Special.Peek;
    }

    /**
     * @param {!Gate} g
     * @returns {boolean}
     * @private
     */
    static _isGateAllowedAfterMeasurementIfNoQuantumControls(g) {
        let m = g.matrixOrFunc;
        let is2x2 = m instanceof Matrix && m.width() == 2 && m.height() == 2;
        let e = 0.00000001;
        let isDiag1 = is2x2 && m.cell(0, 0).isApproximatelyEqualTo(0, e) && m.cell(1, 1).isApproximatelyEqualTo(0, e);
        let isDiag2 = is2x2 && m.cell(1, 0).isApproximatelyEqualTo(0, e) && m.cell(0, 1).isApproximatelyEqualTo(0, e);
        return g === Gates.Named.Special.SwapHalf ||
            g === Gates.Named.Exponentiating.ExpiZ ||
            g === Gates.Named.Exponentiating.AntiExpiZ ||
            g === Gates.Named.Powering.Z ||
            g === Gates.Named.Silly.CLOCK ||
            g === Gates.Named.Powering.AntiZ ||
            isDiag1 ||
            isDiag2;
    }

    /**
     *
     * @param {!Point} pt
     * @returns {!string|null}
     */
    gateAtLocIsDisabledReason(pt) {
        let g = this.gateAtLoc(pt);

        if (g === Gates.Named.Special.Measurement) {
            if (this.colHasControls(pt.x)) {
                return "can't\ncontrol\n(sorry)";
            }
        }

        if (g === Gates.Named.Special.SwapHalf) {
            let pts = Seq.range(this.numWires).
                map(row => new Point(pt.x, row)).
                filter(pt => this.gateAtLoc(pt) === Gates.Named.Special.SwapHalf);
            if (pts.count() === 1) {
                return "need\nother\nswap";
            }
            if (pts.count() > 2) {
                return "too\nmany\nswap";
            }

            if (pts.map(e => this.locIsMeasured(e)).distinct().count() !== 1) {
                // Swapping a measured qubit for an unmeasured qubit could be allowed, but it's not implemented.
                return "measure\ndiffers\n(sorry)";
            }
        }

        if (this.locIsMeasured(pt) && g !== null && !CircuitDefinition._isGateAllowedAfterMeasurement(g)) {
            // Half-turns make sense and don't un-measure, as long as all controls are also measured.
            if (!this.colHasSingleWireControl(pt.x) &&
                    CircuitDefinition._isGateAllowedAfterMeasurementIfNoQuantumControls(g)) {
                return null;
            }

            // Measured qubits are locked for implementation simplicity reasons.
            return "no\nremix\n(sorry)";
        }

        return null;
    }

    /**
     * @param {!int} colIndex
     * @param {!number} time
     * @returns {!(!{m: !Matrix, i: !int}[])}
     */
    singleQubitOperationsInColAt(colIndex, time) {
        if (colIndex < 0 || colIndex >= this.columns.length) {
            return [];
        }

        let I = Matrix.identity(2);
        let col = this.columns[colIndex];
        return Seq.
            range(col.gates.length).
            filter(row => {
                if (col.gates[row] === null || this.gateAtLocIsDisabledReason(new Point(colIndex, row)) !== null) {
                    return false;
                }
                let m = col.gates[row].matrixAt(time);
                return m.width() === 2 && m.height() === 2 && !m.isEqualTo(I);
            }).
            map(i => ({m: col.gates[i].matrixAt(time), i})).
            toArray();
    }

    toString() {
        let w = "─";
        let self = this;
        return Seq.
            range(self.numWires).
            map(r => w + Seq.
                range(this.columns.length).
                map(c => {
                    let g = self.columns[c].gates[r];
                    let t = g === null ? w : g.symbol;
                    return new Seq(t).padded(7, w).join("");
                }).
                join("")).
            join("\n");
    }
}

export default CircuitDefinition;
