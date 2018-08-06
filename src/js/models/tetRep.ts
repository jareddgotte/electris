/**
 * Used in Tet to represent a Tet during the cleanShape() and updateTet() phases
 */
interface TetRep {
  shape: number[][]
  topLeft: {
    row: number;
    col: number;
  }
}
