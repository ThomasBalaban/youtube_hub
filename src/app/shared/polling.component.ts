import { Directive, OnDestroy, OnInit } from '@angular/core';

@Directive()
export abstract class PollingComponent implements OnInit, OnDestroy {
  private _interval?: ReturnType<typeof setInterval>;

  /** Override to change the polling interval in ms. Default: 3000 */
  protected pollingInterval = 3000;

  abstract poll(): void | Promise<void>;

  ngOnInit(): void {
    this.poll();
    this._interval = setInterval(() => this.poll(), this.pollingInterval);
  }

  ngOnDestroy(): void {
    if (this._interval) clearInterval(this._interval);
  }
}
