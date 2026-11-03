export interface TaskListRequest {
  generation: number
  page: number
}

/** Tracks the active filter generation and the last page committed successfully. */
export class TaskListRequestGate {
  private generation = 0
  private committedPage = -1

  beginRefresh(): TaskListRequest {
    this.generation += 1
    this.committedPage = -1
    return { generation: this.generation, page: 0 }
  }

  beginNextPage(): TaskListRequest | null {
    if (this.committedPage < 0) return null
    return { generation: this.generation, page: this.committedPage + 1 }
  }

  isCurrent(request: TaskListRequest): boolean {
    return request.generation === this.generation
  }

  commit(request: TaskListRequest): boolean {
    if (!this.isCurrent(request)) return false
    if (request.page !== this.committedPage + 1) return false
    this.committedPage = request.page
    return true
  }
}
