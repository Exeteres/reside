import { ResideError } from "@reside/common/definitions"

export class InvalidGatewayNameError extends ResideError {
  constructor(readonly gatewayName: string) {
    super(`Gateway name "${gatewayName}" must be a valid DNS label in lowercase`)
  }
}

export class MissingGatewayTitleError extends ResideError {
  constructor(readonly gatewayName: string) {
    super(`Gateway "${gatewayName}" title is required`)
  }
}

export class GatewayOwnershipConflictError extends ResideError {
  constructor(
    readonly gatewayName: string,
    readonly ownerReplicaName: string,
  ) {
    super(`Gateway "${gatewayName}" is already owned by replica "${ownerReplicaName}"`)
  }
}
